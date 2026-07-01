const prefix = "SCv7_32_";

let statusTimer;

function setStatus(text, isError = false) {
    const el = document.getElementById("statusMessage");
    clearTimeout(statusTimer);
    el.textContent = text;
    el.className = "status " + (isError ? "error" : "success");

    statusTimer = setTimeout(() => {
        el.textContent = "";
        el.className = "status";
    }, 2000);
};

// copy to clipboard... but where is the button?
async function copyText(inputId, statusId) {
    const text = document.getElementById(inputId).value;
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        setStatus(statusId, "Copied to clipboard");
    } catch (err) {
        setStatus(statusId, "Failed to copy", true);
    }
};

// so you dont have to import it manually!
async function openInSudokuCoach() {
    let text = document.getElementById("encodedInput").value.trim();
    
    if (!text) {
        setStatus("No sudoku.coach string found", true);
        return;
    }
    const url = "https://sudoku.coach/en/construct/" + text
    window.open(url, "_blank");
};

// modal logic
const modal = document.getElementById("infoModal");
const infoIcon = document.getElementById("infoIcon");
const closeModal = document.getElementById("closeModal");

infoIcon.onclick = () => { modal.style.display = "block" };

closeModal.onclick = () => { modal.style.display = "none" };

window.onclick = function(event) { if (event.target == modal) { modal.style.display = "none" } };

// Base32hex logic
const base32hex = "0123456789ABCDEFGHIJKLMNOPQRSTUV";

function base32hexEncode(bytes) {
    let bits = 0, value = 0, output = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += base32hex[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += base32hex[(value << (5 - bits)) & 31];
    }
    return output;
};

function base32hexDecode(str) {
    str = str.toUpperCase();
    let bits = 0, value = 0;
    const output = [];
    for (const ch of str) {
        const idx = base32hex.indexOf(ch);
        if (idx === -1) {
            throw new Error(`Invalid character: ${ch}`);
        }
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return new Uint8Array(output);
};

// compression
async function compressZlib(bytes) {
    const stream = new CompressionStream("deflate");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const compressed = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(compressed);
};

async function decompressZlib(bytes) {
    const stream = new DecompressionStream("deflate");
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const decompressed = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(decompressed);
};

// regions (global) =/= region (constraint) !!

const templates = {
    emptyBoard:
    `{
        "gridSize": 0,
        "regions": [],
        "givenConstraints": []
    }`,

    emptyConstraint:
    `{
        "gridSize": 0,
        "regions": [],
        "givenConstraints": [ {
            "id": 0,
            "type": "cosmeticText",
            "segments": [ { "cells": [], "parameters": {} } ]
        } ],
        "settings": { "_comment": "New comment" }
    }`,
    
    templateGlobal:
    `{
        "id": 0,
        "type": "globalConstraint",
        "segments": [],
        "settings": {}
    }`,
    
    templateLine:
    `{
        "id": 0,
        "type": "constraintLine",
        "segments": [
            { "cells": [], "parameters": { "_comment": "'cells' is an ordered list of cell indices describing the line"  } }
        ],
        "settings": {
            "opacity": 255,
            "colour": "lineColour",
            "lineThickness": 18,
            "lineEndOffset": 0,
            "borderColour": "#aaaaaa",
            "borderThickness": 3
        }
    }`,
    
    templateOneCell:
    `{
        "id": 0,
        "type": "constraintCells",
        "segments": [
            { "cells": [], "parameters": {"_comment": "'cells' must contain exactly one cell index" } }
        ],
        "settings": {
            "opacity": 255,
            "colour": "cellColour",
            "shapeSize": 63,
            "borderColour": "#aaaaaa",
            "borderThickness": 3     
        }
    }`,
    
    templateTwoCells:
    `{
        "id": 0,
        "type": "constraintCells",
        "segments": [
            { "cells": [], "parameters": {"_comment": "'cells' must contain exactly two cell indices" } }
        ],
        "settings": {}
    }`, 

    cage:
    `{
        "id": 0,
        "type": "cage",
        "segments": [
            { "cells": [], "parameters": { "_comment": "'cells' is an ordered list of cell indices describing the cage", "sum": 0 } }
        ],
        "settings": {
            "colour": "#000000",
            "opacity": 255,
            "thickness": 2,
            "horizontalOffset": 0
        }
    }`,
    
    sandwich:
    `{
        "id": 0,
        "type": "sandwich",
        "segments": [
            { "cells": [], "parameters": {
                "side": "top",
                "index": 0,
                "value": 0,
                "_comment": "'side' is one of 'top', 'bottom', 'left' or 'right'; 'index' is the row/column number (0-based); 'value' is the sandwich sum"
                }
            }
        ],
        "settings": {
            "outsideLevel": 1,
            "textColour": "#000000"
        }
    }`,
    
    littleKiller:
    `{
        "id": 0,
        "type": "littleKiller",
        "segments": [
            { "cells": [[0, -1]], "parameters": {
                "positive": false,
                "value": 0,
                "_comment": "'cells' contains a single coordinate [x, y] representing the clue position outside the grid and the coordinate must be exactly one cell beyond an edge ( [r±1, c] or [r, c±1], where [r, c] is a border cell of the grid ); 'positive' selects the diagonal direction: true = (⟋), false = (⟍); 'value' is the required sum along that diagonal"
            } }
        ],
        "settings": {
            "colour": "#000000"
        }
    }`,
    
    comment: `{ "_comment": "New comment" }`
};

const storedRegions = [
    [1],
    [1,1,2,2],
    [1,1,1,2,2,2,3,3,3],
    [1,1,2,2,1,1,2,2,3,3,4,4,3,3,4,4],
    [1,1,1,2,2,1,1,2,2,2,3,3,3,3,3,4,4,4,5,5,4,4,5,5,5],
    [1,1,1,2,2,2,1,1,1,2,2,2,3,3,3,4,4,4,3,3,3,4,4,4,5,5,5,6,6,6,5,5,5,6,6,6],
    [1,1,1,2,3,3,3,1,1,1,2,3,3,3,1,2,2,2,2,2,3,4,4,4,4,4,4,4,5,5,5,6,7,7,7,5,5,5,6,7,7,7,5,6,6,6,6,6,7],
    [1,1,1,1,2,2,2,2,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,5,5,5,5,6,6,6,6,7,7,7,7,8,8,8,8,7,7,7,7,8,8,8,8],
    [1,1,1,2,2,2,3,3,3,1,1,1,2,2,2,3,3,3,1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,6,6,6,4,4,4,5,5,5,6,6,6,4,4,4,5,5,5,6,6,6,7,7,7,8,8,8,9,9,9,7,7,7,8,8,8,9,9,9,7,7,7,8,8,8,9,9,9]
    // lol
];

const globalConstraints = [
    "diagonalNegative",
    "diagonalPositive",
    "antiKnight",
    "antiKing",
    "nonconsecutive",
    "entropy",
    "fog"
];

const lineConstraints = [
    "thermometer",
    "arrow",
    "pillArrow",
    "whisper",
    "betweenLine",
    "lockoutLine",
    "renban",
    "entropicLine",
    "modularLine",
    "palindromeLine",
    "consecutiveLine",
    "regionSumLine",
    "cosmeticLine"
];

const oneCellConstraints = [
    "odd",
    "even",
    "quadruple",
    "minimum",
    "maximum",
    "cosmeticText",
    "cosmeticShape"
];

const twoCellsConstraints = [
    "twoCellSum",
    "difference",
    "ratio",
    "greaterLess"
];

function detectLineConstraint(lineType, json) {
    json.givenConstraints.push(JSON.parse(templates.templateLine));
    const constraint = json.givenConstraints[json.givenConstraints.length - 1];
    constraint.type = lineType;
    const lineSettings = constraint.settings;

    if (lineType === "thermometer") {
        lineSettings.colour = "#d5e2ff";
        lineSettings.lineEndOffset = 5;
        lineSettings.bulbSize = 63;
    }
    if (lineType === "arrow" || lineType === "pillArrow" || lineType === "betweenLine") {
        lineSettings.colour = "#aaaaaa";
        lineSettings.lineEndOffset = 5;
        lineSettings.bulbSize = 80;
        lineSettings.bulbFillColour = "#ffffff";
        lineSettings.bulbBorderThickness = 14;
        lineSettings.bulbBorderColour = "#aaaaaa";
        lineType == "betweenLine" ? lineSettings.lineEndOffset = 0 : lineSettings.arrowHeadLength = 38; // yeah...
    }
    if (lineType === "whisper" || lineType === "consecutiveLine") {
        lineSettings.colour = "#d5ffd9";
        lineType === "whisper" ? lineSettings.difference = 5 : lineSettings.colour = "#d5ffd9";
    }
    if (lineType === "lockoutLine") {
        lineSettings.colour = "#d5e2ff";
        lineSettings.bulbSize = 62;
        lineSettings.bulbFillColour = "#ffffff";
        lineSettings.bulbBorderThickness = 12;
        lineSettings.bulbBorderColour = "#798dbb";
    }
    if (lineType === "renban") { lineSettings.colour = "#ffd5fc" };
    if (lineType === "entropicLine") { lineSettings.colour = "#ffccaa" };
    if (lineType === "modularLine" || lineType === "palindromeLine") { lineSettings.colour = "#f5e4cc" };
    if (lineType === "regionSumLine") { lineSettings.colour = "#d5ffff" };
    if (lineType === "cosmeticLine") { lineSettings.colour = "#000000" };
};

function detectOneCellConstraint(cellType, json) {
    json.givenConstraints.push(JSON.parse(templates.templateOneCell));
    const constraint = json.givenConstraints[json.givenConstraints.length - 1];
    constraint.type = cellType;
    const cellSettings = constraint.settings;
    const cellSegments = constraint.segments[0];

    if (cellType === "odd" || cellType === "even") { cellSettings.colour = "#d5e2ff" };
    if (cellType === "quadruple") {
        cellSegments.parameters.digits = "0"
        cellSettings.colour = "#000000";
        cellSettings._comment = "'digits' inside 'parameters' must be (at most) a four number string"
    }
    if (cellType === "minimum" || cellType === "maximum") { cellSettings.colour = "#000000" };
    if (cellType === "cosmeticText" || cellType === "cosmeticShape") {
        cellSegments.cells = [[0, 0]];
        cellType == "cosmeticText" ? cellSegments.parameters.text = "Insert Text" : cellSegments.parameters.shape = "rect";
        
        cellType == "cosmeticText" ? cellSettings.colour = "#000000" : cellSettings.colour = "#d5e2ff";
        cellSettings.gridResolution = 1;
        cellSettings.gridZoomOut = 0;
        cellSettings.gridSnapToCentres = true;
        cellSettings.gridSnapToCorners = false;
        cellSettings.gridSnapToEdges = false;
        cellSettings.shapeRotation = 0;
        cellType == "cosmeticText" ? cellSettings.shapeRotation = 0 : cellSettings._comment = "'shape' inside 'parameters' has to be either:\n'rect'\n'circle'\n'polygon-3\n'polygon-5'\n'polygon-6'\n'plus''"; // oops, again
    }
    if (cellType === "_comment") {cellSettings._comment = "" };
};

function detectTwoCellConstraint(cellsType, json) {
    json.givenConstraints.push(JSON.parse(templates.templateTwoCells));
    const constraint = json.givenConstraints[json.givenConstraints.length - 1];
    constraint.type = cellsType;
    const cellParameters = constraint.segments[0].parameters;

    if (cellsType === "twoCellSum") {cellParameters.sum = 5};
    if (cellsType === "difference") {cellParameters.difference = 1};
    if (cellsType === "ratio") {cellParameters.ratio = 2};
}

function insertTemplate(templateType) {
    if (!templateType) return;

    if (templateType === "emptyBoard") {
        document.getElementById("jsonInput").value = formatSudokuJson(JSON.parse(templates.emptyBoard));
        document.getElementById("insertType").value = "";
        return;
    }

    let json;
    const jsonText = document.getElementById("jsonInput").value.trim();
    if (!jsonText) { json = JSON.parse(templates.emptyBoard); } 
    else { json = JSON.parse(jsonText); }

    if (templateType === "regions") { json.regions = storedRegions[json.gridSize - 1] };
    
    if (templateType === "comment") {
        if (json.givenConstraints.length === 0) { json.givenConstraints.push(JSON.parse(templates.emptyConstraint)) };
        const lastConstraint = json.givenConstraints[json.givenConstraints.length - 1];
        if (!lastConstraint.settings) { lastConstraint.settings = {}; }
        lastConstraint.settings._comment = "New comment";
    } else {
        if (!json.givenConstraints) { json.givenConstraints = []; }
        if (globalConstraints.includes(templateType)) {
            if (json.givenConstraints.some( constraint => constraint.type === templateType )) {
                setStatus("Constraint already in JSON", true);
                document.getElementById("insertType").value = "";
                return;
            } else {
                json.givenConstraints.push(JSON.parse(templates.templateGlobal));
                json.givenConstraints[json.givenConstraints.length - 1].type = templateType;
                if (templateType === "fog") {
                    json.givenConstraints[json.givenConstraints.length - 1].segments = [{
                        cells: [],
                        parameters: {
                            _comment: "'cells' is an ordered list of cell indices describing the unfogged region"
                        }
                    }];
                }
            }
        }
        else if (lineConstraints.includes(templateType)) { detectLineConstraint(templateType, json) }
        else if (oneCellConstraints.includes(templateType)) { detectOneCellConstraint(templateType, json) }
        else if (twoCellsConstraints.includes(templateType)) { detectTwoCellConstraint(templateType, json) }
        else if (templateType === "cage" || templateType === "cosmeticCage") {
            json.givenConstraints.push(JSON.parse(templates.cage));
            if (templateType === "cosmeticCage") { json.givenConstraints[json.givenConstraints.length - 1].type = "cosmeticCage"; }
        }
        else if (templateType === "sandwich" ) { json.givenConstraints.push(JSON.parse(templates.sandwich)) }
        else if (templateType === "littleKiller" ) { json.givenConstraints.push(JSON.parse(templates.littleKiller)) }
    }

    document.getElementById("jsonInput").value = formatSudokuJson(json);
    document.getElementById("insertType").value = "";
};

var exampleString = [ "SCv7_32_f2e9alatdvljc37t5eefd40n4bo4fr5efqshguk1c700c32rg4v39gd0926aql8m0d4kt6omvnno7r3smirkn1qb1a4ugk27st899sp2b9nv8nv6j52771a2m7is21uhri5uro5nio28ld8tq8bnnqeq6hkjrre51a2qfllg9esji5l3bu6pt3vudlae65emb1h3ipmmkejmh0elt33mgsca2o3qvc2qk5kcr3msav9pk6244epapikibliuurchcnqii637v4q1e1s4jehk10c8j2iov4b0399lg84msd4b6p75vcoti6efgnkaasc9qruomc2q6hsoc8nemsi1l8eo0l946d1rvb6rgl5t81mkvhrc8nb8s1dce2ok5cclbrr18afhfdsnqnd5tgc8qqt7307v1u89rr5mhu0id18m6vnt5nl62icjpulsm6okcvvb5fa8v8df637jsb1gsof82f36bu7i0jvth6dg4lvl2gcecm6kb2f59tc1de68m3uducg9dkr1nsn42i4qcf3mmhkc93ri6houdcboed6a39r8qhjmet2vprpkanj176vitqjagkkht8raumgg8vpbto9o4q643lcsafftm1qbf789817r5nqqgbmv1v3c14f6a075953d440p8b3ouig6gbc1341mi7um37b22uin2qeiuvm54v787d41k0i8kt0s4k88i2ik8051ctmjd1hkdjcc7j7kbc7c3b1dg5insc5ejk0qvvp12n1t5nackg1ihqc0jnes76h08jra9gdoc0qc2m9689g30s8mo39q8lif3ar5cag2t70bh7cpmotb3cm6q79druhtl17blllo2prd43gk22idca9stc50hr61af7rnt037mcp1jgor2iv9m4h0dp8ltaklh1jqp9bhkdimi843kvk461k7s677haiem9pc0160r835il5vcsta3f855t8jc77c5a2srb093a26s7cp0fr00rc7jrt1rr1ep3sdqv3sccihdkmagqep5jet5n0dru9okhq6ntv6rocnnffgnsd1a5sin5c9fb8u8t4f4aaefdhjtf0522ei3ler5lv4roucosbtbfvkj07ci7rh6j3hdrjumgpqrv955f6pprsbpgjrvsfsq6mil93kq5v59nr7t7vvgqjhhtl1j0mo6drd2qv7q9pp9eb8t7n3un7l75j2t88sjfrv85vov20305cnm8ks6pd4e2j773ovkbkn81mdg"
];

async function SCBoardExample() {
    document.getElementById("encodedInput").value = exampleString;
    await decodeSCString();
    modal.style.display = "none";
    setStatus("Example loaded");
};

// custom JSON formatter
// suffering ft. regex
function formatSudokuJson(obj) {
    const raw = JSON.stringify(obj, null, 2);

    let result = raw;

    // collapse arrays of primitives or arrays-of-arrays onto one line
    result = result.replace(/\[[\s\n]+((?:(?:\[[\s\n]+[\d.,\s\n-]+[\s\n]+\]|[\d.,-]+)[\s\n]*,?[\s\n]*)+)[\s\n]+\]/g, (match) => {
        const inner = match.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/,\s+/g, ', ').trim();
        return inner;
    });

    // also collapse empty objects {}
    result = result.replace(/\{\s*\n\s*\}/g, '{ }');

    // collapse the full segment line { "cells": [...], "parameters": { ... } }  onto one line
    result = result.replace(/\{\s*\n\s*"cells": (\[.*?\])\s*,\s*\n\s*"parameters": (\{.*?\})\s*\n\s*\}/gs, (_, cells, params) => `{ "cells": ${cells}, "parameters": ${params} }`);
    
    // collapse the double keys }, ... { onto one line
    result = result.replace(/\}\s*,\s*[\r\n]+\s*\{/g, '}, {');

    return result;
};

function findComments(obj, results = []) {
    if (!obj || typeof obj !== "object") return results;
    if ("_comment" in obj) results.push(obj._comment);
    if (Array.isArray(obj)) {
        for (const item of obj)
            findComments(item, results);
    } else {
        for (const value of Object.values(obj)) findComments(value, results);
    }
    return results;
};

function showComment(obj) {
    const box = document.getElementById("commentBox");
    const text =document.getElementById("commentText");
    const comments = findComments(obj);
    if (comments.length > 0) {
        text.innerHTML = comments.map(c => String(c)).join("<hr>");
        box.style.display = "block";
    } else { box.style.display = "none"; }
};


// decode the string
async function decodeSCString() {
    try {
        let text = document.getElementById("encodedInput").value.trim();
        if (!text) throw new Error("Input is empty");
        
        if (text.startsWith(prefix)) {
            text = text.slice(prefix.length);
        }

        const compressed = base32hexDecode(text);
        const jsonBytes = await decompressZlib(compressed);
        const jsonText = new TextDecoder().decode(jsonBytes);
        const obj = JSON.parse(jsonText);

        document.getElementById("jsonInput").value = formatSudokuJson(obj);

        showComment(obj);
        setStatus("Successfully decoded");
    } catch (err) {
        setStatus(err.message, true);
    }
};

// encode the json
async function encodeFormatJson() {
    try {
        const text = document.getElementById("jsonInput").value.trim();
        if (!text) throw new Error("JSON input is empty");

        const obj = JSON.parse(text);
        const compact = JSON.stringify(obj);
        const bytes = new TextEncoder().encode(compact);
        const compressed = await compressZlib(bytes);
        const encoded = base32hexEncode(compressed).toLowerCase();

        document.getElementById("encodedInput").value = prefix + encoded;
        setStatus("Successfully encoded");
    } catch (err) {
        setStatus(err.message, true);
    }
};