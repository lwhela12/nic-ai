"use strict";
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
exports.getActiveCaseLock = getActiveCaseLock;
exports.acquireCaseLock = acquireCaseLock;
exports.releaseCaseLock = releaseCaseLock;
var fs_1 = require("fs");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var LOCK_DIR = ".ai_tool/locks";
var LOCK_FILE = "write.lock.json";
var DEFAULT_TTL_MS = 10 * 60 * 1000;
function lockPath(caseFolder) {
    return (0, path_1.join)(caseFolder, LOCK_DIR, LOCK_FILE);
}
function isExpired(lock) {
    return new Date(lock.expiresAt).getTime() <= Date.now();
}
function readLock(caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        var path, raw, parsed, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    path = lockPath(caseFolder);
                    if (!(0, fs_1.existsSync)(path))
                        return [2 /*return*/, null];
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 5, , 6]);
                    return [4 /*yield*/, (0, promises_1.readFile)(path, "utf-8")];
                case 2:
                    raw = _b.sent();
                    parsed = JSON.parse(raw);
                    if (!isExpired(parsed)) return [3 /*break*/, 4];
                    return [4 /*yield*/, (0, promises_1.rm)(path, { force: true })];
                case 3:
                    _b.sent();
                    return [2 /*return*/, null];
                case 4: return [2 /*return*/, parsed];
                case 5:
                    _a = _b.sent();
                    return [2 /*return*/, null];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function getActiveCaseLock(caseFolder) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, readLock(caseFolder)];
        });
    });
}
function acquireCaseLock(caseFolder_1, owner_1, displayName_1) {
    return __awaiter(this, arguments, void 0, function (caseFolder, owner, displayName, ttlMs) {
        var current, dir, lock;
        if (ttlMs === void 0) { ttlMs = DEFAULT_TTL_MS; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, readLock(caseFolder)];
                case 1:
                    current = _a.sent();
                    if (current && current.owner !== owner) {
                        return [2 /*return*/, { acquired: false, lock: current }];
                    }
                    dir = (0, path_1.join)(caseFolder, LOCK_DIR);
                    return [4 /*yield*/, (0, promises_1.mkdir)(dir, { recursive: true })];
                case 2:
                    _a.sent();
                    lock = {
                        owner: owner,
                        displayName: displayName,
                        acquiredAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
                    };
                    return [4 /*yield*/, (0, promises_1.writeFile)(lockPath(caseFolder), JSON.stringify(lock, null, 2), "utf-8")];
                case 3:
                    _a.sent();
                    return [2 /*return*/, { acquired: true, lock: lock }];
            }
        });
    });
}
function releaseCaseLock(caseFolder, owner) {
    return __awaiter(this, void 0, void 0, function () {
        var current;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, readLock(caseFolder)];
                case 1:
                    current = _a.sent();
                    if (!current)
                        return [2 /*return*/];
                    if (current.owner !== owner)
                        return [2 /*return*/];
                    return [4 /*yield*/, (0, promises_1.rm)(lockPath(caseFolder), { force: true })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
