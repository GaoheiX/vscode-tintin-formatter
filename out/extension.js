"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
/* --- A formázó függvények --- */
function extractBlock(str, start) {
    if (str[start] !== '{')
        return null;
    let level = 0;
    let i = start;
    while (i < str.length) {
        if (str[i] === '{') {
            level++;
        }
        else if (str[i] === '}') {
            level--;
            if (level === 0) {
                return { block: str.substring(start + 1, i), end: i };
            }
        }
        i++;
    }
    return null;
}
function splitTopLevel(str, delimiter) {
    let result = [];
    let current = "";
    let level = 0;
    for (let i = 0; i < str.length; i++) {
        let char = str[i];
        if (char === '{') {
            level++;
            current += char;
        }
        else if (char === '}') {
            level--;
            current += char;
        }
        else if (char === delimiter && level === 0) {
            result.push({ text: current, hasSemicolon: true });
            current = "";
        }
        else {
            current += char;
        }
    }
    if (current.trim() !== "") {
        result.push({ text: current, hasSemicolon: false });
    }
    return result;
}
function processInstruction(text, indent) {
    let result = "";
    let i = 0;
    while (i < text.length) {
        if (text[i] === '{') {
            // Ellenőrizzük, hogy a '{' előtt van-e egy @jel és szöveg (szóközök nélkül)
            let j = i - 1;
            let prefix = "";
            while (j >= 0 && /\S/.test(text[j])) {
                prefix = text[j] + prefix;
                j--;
            }
            if (/@\w+$/.test(prefix)) {
                let ext = extractBlock(text, i);
                if (ext) {
                    // Védett blokk: speciális jelzőkkel kerüljön a formázásból
                    let rawBlock = text.substring(i, ext.end + 1);
                    result += "__RAW_BLOCK_START__" + rawBlock + "__RAW_BLOCK_END__";
                    i = ext.end + 1;
                    continue;
                }
            }
            let ext = extractBlock(text, i);
            if (ext) {
                let formatted = formatBlock(ext.block, indent + 1);
                result += formatted;
                i = ext.end + 1;
            }
            else {
                result += text[i];
                i++;
            }
        }
        else {
            result += text[i];
            i++;
        }
    }
    return result;
}
function formatBlock(content, indent) {
    let indentSpaces = "  ".repeat(indent);
    let innerIndent = "  ".repeat(indent + 1);
    let instructions = splitTopLevel(content, ';').filter(instr => instr.text.trim() !== "");
    let lines = "{\n";
    instructions.forEach(element => {
        let candidate = processInstruction(element.text, indent);
        let semic = candidate.indexOf("\n") !== -1 ? "!" : "";
        lines += innerIndent + candidate.trim();
        if (instructions.length !== 1) {
            lines += ";";
        }
        lines += "\n";
    });
    lines += indentSpaces + "}";
    return lines;
}
function uppercaseHashFirstWord(text) {
    return text.replace(/#(\S+)/g, (match, word) => {
        if (/^gts(\W|$)/i.test(word)) {
            return '#gts' + word.substring(3);
        }
        return '#' + word.toUpperCase();
    });
}
function pullBackOpeningBrace(text) {
    return text.replace(/(\S)\s+(\{)/g, '$1 $2');
}
function compactBracesContent(text) {
    // Ideiglenesen kivesszük a védett blokkokat a formázásból
    let rawBlockRegex = /__RAW_BLOCK_START__(.*?)__RAW_BLOCK_END__/g;
    let rawBlocks = [];
    text = text.replace(rawBlockRegex, (match, p1) => {
        rawBlocks.push(p1);
        return `__RAW_BLOCK_PLACEHOLDER__${rawBlocks.length - 1}__`;
    });
    let regex = /\{([^{}]*)\}/g;
    let replaced = text;
    let changed = true;
    while (changed) {
        changed = false;
        replaced = replaced.replace(regex, (match, content) => {
            if (content.indexOf(';') !== -1) {
                return match;
            }
            const trimmed = content.trim();
            if (trimmed !== content) {
                changed = true;
            }
            return '{' + trimmed + '}';
        });
    }
    replaced = replaced.replace(/__RAW_BLOCK_PLACEHOLDER__(\d+)__/g, (match, index) => {
        return "__RAW_BLOCK_START__" + rawBlocks[Number(index)] + "__RAW_BLOCK_END__";
    });
    return replaced;
}
function formatCommands(input) {
    let output = "";
    let lastIndex = 0;
    const commandRegex = /(#(?:action|macro|function|alias|config|event|if|while|ticker|substitute))\s*(?:\{([^}]*)\}|([^\s\{]+))\s*/gi;
    let match;
    while ((match = commandRegex.exec(input)) !== null) {
        output += uppercaseHashFirstWord(input.substring(lastIndex, match.index));
        let keyword = match[1].toUpperCase();
        let firstBlockContent = (typeof match[2] !== "undefined") ? match[2] : match[3];
        let formattedFirst = "{" + firstBlockContent + "}";
        let secondBlockStart = input.indexOf('{', commandRegex.lastIndex);
        if (secondBlockStart === -1) {
            output += uppercaseHashFirstWord(input.substring(match.index));
            lastIndex = input.length;
            break;
        }
        let ext = extractBlock(input, secondBlockStart);
        if (!ext) {
            output += uppercaseHashFirstWord(input.substring(match.index));
            lastIndex = input.length;
            break;
        }
        let secondBlockContent = ext.block;
        let secondBlockEnd = ext.end;
        commandRegex.lastIndex = secondBlockEnd + 1;
        lastIndex = secondBlockEnd + 1;
        let formattedSecond = formatBlock(secondBlockContent, 0);
        let finalSecond = uppercaseHashFirstWord(pullBackOpeningBrace(compactBracesContent(formattedSecond)))
            .replace(/__RAW_BLOCK_START__|__RAW_BLOCK_END__/g, "");
        let formattedCommand = keyword + " " + formattedFirst + " " + finalSecond;
        output += formattedCommand;
    }
    output += uppercaseHashFirstWord(input.substring(lastIndex));
    return output;
}
function fixBraces(text) {
    return text.replace(/}\s*\{/g, '} {');
}
function formatTinCode(input) {
    let formatted = formatCommands(input);
    return fixBraces(formatted);
}
/* --- VS Code extension kód --- */
function activate(context) {
    // Dokumentumformázó provider regisztrálása .tin fájlokhoz
    const provider = {
        provideDocumentFormattingEdits(document) {
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
            const formatted = formatTinCode(document.getText());
            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    };
    const disposableProvider = vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'file', language: 'tin' }, provider);
    context.subscriptions.push(disposableProvider);
    // Parancs regisztrálása, mely a beépített formázó parancsot hívja meg (ezt a keybinding aktiválja)
    const command = vscode.commands.registerCommand('extension.formatTin', () => {
        if (vscode.window.activeTextEditor) {
            vscode.commands.executeCommand('editor.action.formatDocument');
        }
    });
    context.subscriptions.push(command);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map