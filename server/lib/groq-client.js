"use strict";
/**
 * Groq SDK Client
 *
 * Singleton client for Groq API access. Requires GROQ_API_KEY env var.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroqClient = getGroqClient;
var groq_sdk_1 = require("groq-sdk");
var _groq = null;
var _groqRequestCount = 0;
var GROQ_CLIENT_RESET_THRESHOLD = 50;
function getGroqClient() {
    if (!_groq || _groqRequestCount >= GROQ_CLIENT_RESET_THRESHOLD) {
        var apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error("GROQ_API_KEY environment variable is required");
        }
        _groq = new groq_sdk_1.default({ apiKey: apiKey, timeout: 120000 });
        _groqRequestCount = 0;
    }
    _groqRequestCount++;
    return _groq;
}
