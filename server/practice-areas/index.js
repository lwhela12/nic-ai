"use strict";
/**
 * Practice Areas Registry
 *
 * Central registry for all practice area modules.
 * Core code uses this registry to access practice-area-specific
 * configuration without hardcoding law-specific values.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRACTICE_AREAS = exports.WC_PHASES = exports.WC_DOC_TYPES = exports.PI_PHASES = exports.PI_DOC_TYPES = exports.practiceAreaRegistry = void 0;
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var types_1 = require("./types");
var config_1 = require("./personal-injury/config");
var config_2 = require("./workers-comp/config");
// Get directory path for loading markdown files
var __dirname = (0, path_1.dirname)((0, url_1.fileURLToPath)(import.meta.url));
/**
 * Load a markdown prompt file for a practice area.
 * Returns empty string if file doesn't exist.
 */
function loadPrompt(areaCode, filename) {
    var areaDir = areaCode === "PI" ? "personal-injury" : "workers-comp";
    var promptPath = (0, path_1.join)(__dirname, areaDir, filename);
    if (!(0, fs_1.existsSync)(promptPath)) {
        console.warn("[PracticeAreas] Prompt file not found: ".concat(promptPath));
        return "";
    }
    try {
        return (0, fs_1.readFileSync)(promptPath, "utf-8");
    }
    catch (err) {
        console.error("[PracticeAreas] Error loading prompt: ".concat(promptPath), err);
        return "";
    }
}
/**
 * Build the full practice area config by loading prompts from files.
 */
function buildConfig(metadata, documentTypes, phases) {
    return {
        code: metadata.code,
        name: metadata.name,
        documentTypes: documentTypes,
        phases: phases,
        extractionPrompt: loadPrompt(metadata.code, "extraction.md"),
        extractionPromptWithTools: loadPrompt(metadata.code, "extraction-with-tools.md"),
        synthesisPrompt: loadPrompt(metadata.code, "synthesis.md"),
    };
}
// Build configs (prompts loaded lazily on first access)
var _piConfig = null;
var _wcConfig = null;
function getPIConfig() {
    if (!_piConfig) {
        _piConfig = buildConfig(config_1.PI_METADATA, config_1.PI_DOC_TYPES, config_1.PI_PHASES);
    }
    return _piConfig;
}
function getWCConfig() {
    if (!_wcConfig) {
        _wcConfig = buildConfig(config_2.WC_METADATA, config_2.WC_DOC_TYPES, config_2.WC_PHASES);
    }
    return _wcConfig;
}
/**
 * Practice area registry implementation.
 */
exports.practiceAreaRegistry = {
    get: function (code) {
        var upperCode = code.toUpperCase();
        if (upperCode === "PI")
            return getPIConfig();
        if (upperCode === "WC")
            return getWCConfig();
        return undefined;
    },
    getByName: function (name) {
        var lowerName = name.toLowerCase();
        if (lowerName.includes("personal") || lowerName.includes("injury")) {
            return getPIConfig();
        }
        if (lowerName.includes("worker") || lowerName.includes("compensation")) {
            return getWCConfig();
        }
        return undefined;
    },
    getDefault: function () {
        return getPIConfig();
    },
    list: function () {
        return [getPIConfig(), getWCConfig()];
    },
    getAllDocumentTypes: function () {
        return __spreadArray(__spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_1.PI_DOC_TYPES, true), config_2.WC_DOC_TYPES, true);
    },
    getDocumentTypesFor: function (code) {
        var upperCode = code.toUpperCase();
        if (upperCode === "PI") {
            return __spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_1.PI_DOC_TYPES, true);
        }
        if (upperCode === "WC") {
            return __spreadArray(__spreadArray([], types_1.SHARED_DOC_TYPES, true), config_2.WC_DOC_TYPES, true);
        }
        // Default to all types
        return this.getAllDocumentTypes();
    },
};
// Re-export types and shared constants
__exportStar(require("./types"), exports);
var config_3 = require("./personal-injury/config");
Object.defineProperty(exports, "PI_DOC_TYPES", { enumerable: true, get: function () { return config_3.PI_DOC_TYPES; } });
Object.defineProperty(exports, "PI_PHASES", { enumerable: true, get: function () { return config_3.PI_PHASES; } });
var config_4 = require("./workers-comp/config");
Object.defineProperty(exports, "WC_DOC_TYPES", { enumerable: true, get: function () { return config_4.WC_DOC_TYPES; } });
Object.defineProperty(exports, "WC_PHASES", { enumerable: true, get: function () { return config_4.WC_PHASES; } });
/**
 * Convenience constants matching the old PRACTICE_AREAS object.
 * For backward compatibility during migration.
 */
exports.PRACTICE_AREAS = {
    PI: "Personal Injury",
    WC: "Workers' Compensation",
};
