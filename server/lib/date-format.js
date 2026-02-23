"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateYYYYMMDD = formatDateYYYYMMDD;
exports.formatDateMMDDYYYY = formatDateMMDDYYYY;
exports.parseFlexibleDate = parseFlexibleDate;
function isValidDateParts(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return false;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return false;
    }
    var date = new Date(year, month - 1, day);
    return (date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day);
}
function normalizeDateInput(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number") {
        var parsed_1 = new Date(value);
        return Number.isNaN(parsed_1.getTime()) ? null : parsed_1;
    }
    var trimmed = value.trim();
    if (!trimmed)
        return null;
    var isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
        var year = Number(isoDateOnly[1]);
        var month = Number(isoDateOnly[2]);
        var day = Number(isoDateOnly[3]);
        if (!isValidDateParts(year, month, day))
            return null;
        return new Date(year, month - 1, day);
    }
    var mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (mdy) {
        var month = Number(mdy[1]);
        var day = Number(mdy[2]);
        var year = Number(mdy[3]);
        if (year < 100)
            year += year >= 70 ? 1900 : 2000;
        if (!isValidDateParts(year, month, day))
            return null;
        return new Date(year, month - 1, day);
    }
    var parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function pad2(value) {
    return String(value).padStart(2, "0");
}
function formatDateYYYYMMDD(value) {
    var parsed = normalizeDateInput(value);
    if (!parsed)
        return "";
    return "".concat(parsed.getFullYear(), "-").concat(pad2(parsed.getMonth() + 1), "-").concat(pad2(parsed.getDate()));
}
function formatDateMMDDYYYY(value) {
    var parsed = normalizeDateInput(value);
    if (!parsed)
        return "";
    return "".concat(pad2(parsed.getMonth() + 1), "-").concat(pad2(parsed.getDate()), "-").concat(parsed.getFullYear());
}
function parseFlexibleDate(value) {
    return normalizeDateInput(value);
}
