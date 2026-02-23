"use strict";
/**
 * Backward-compatible migration: rename .pi_tool → .ai_tool
 *
 * Called once per folder when accessed. If .pi_tool exists and .ai_tool does not,
 * renames the directory. If both exist, leaves them as-is (manual resolution needed).
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migratePiTool = migratePiTool;
var promises_1 = require("fs/promises");
var path_1 = require("path");
var OLD_DIR = ".pi_tool";
var NEW_DIR = ".ai_tool";
function pathExists(p) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, promises_1.stat)(p)];
                case 1:
                    _b.sent();
                    return [2 /*return*/, true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Migrate a single folder's .pi_tool to .ai_tool if needed.
 * Returns true if migration occurred, false if no action taken.
 */
function migratePiTool(folderPath) {
    return __awaiter(this, void 0, void 0, function () {
        var oldPath, newPath, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    oldPath = (0, path_1.join)(folderPath, OLD_DIR);
                    newPath = (0, path_1.join)(folderPath, NEW_DIR);
                    return [4 /*yield*/, pathExists(oldPath)];
                case 1:
                    // Skip if old dir doesn't exist or new dir already exists
                    if (!(_a.sent()))
                        return [2 /*return*/, false];
                    return [4 /*yield*/, pathExists(newPath)];
                case 2:
                    if (_a.sent())
                        return [2 /*return*/, false];
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, (0, promises_1.rename)(oldPath, newPath)];
                case 4:
                    _a.sent();
                    console.log("[migrate] Renamed ".concat(oldPath, " \u2192 ").concat(newPath));
                    return [2 /*return*/, true];
                case 5:
                    err_1 = _a.sent();
                    console.error("[migrate] Failed to rename ".concat(oldPath, ":"), err_1);
                    return [2 /*return*/, false];
                case 6: return [2 /*return*/];
            }
        });
    });
}
