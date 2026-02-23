"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.getPermissionsForRole = getPermissionsForRole;
exports.loadTeamState = loadTeamState;
exports.saveTeamState = saveTeamState;
exports.resolveTeamContext = resolveTeamContext;
exports.requireTeamContext = requireTeamContext;
exports.createTeamInvite = createTeamInvite;
exports.revokeInvite = revokeInvite;
exports.updateMemberRole = updateMemberRole;
exports.listTeamForUser = listTeamForUser;
exports.ensureTeamMember = ensureTeamMember;
exports.bootstrapTeamFounder = bootstrapTeamFounder;
var fs_1 = require("fs");
var promises_1 = require("fs/promises");
var path_1 = require("path");
var crypto_1 = require("crypto");
var TEAM_FILE = "team.json";
var TOOL_DIR = ".ai_tool";
var TEAM_VERSION = 1;
var INVITE_EXPIRY_DAYS = 30;
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function nowIso() {
    return new Date().toISOString();
}
function getFoundersFromEnv() {
    var raw = process.env.CLAUDE_PI_APPROVED_FOUNDERS || "";
    return raw
        .split(",")
        .map(function (e) { return normalizeEmail(e); })
        .filter(Boolean);
}
function getTeamPath(firmRoot) {
    return (0, path_1.join)(firmRoot, TOOL_DIR, TEAM_FILE);
}
function createEmptyTeam() {
    var timestamp = nowIso();
    return {
        version: TEAM_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        members: [],
        invites: [],
    };
}
function getPermissionsForRole(role) {
    switch (role) {
        case "attorney":
            return {
                canManageTeam: true,
                canAssignCases: true,
                canViewAllCases: true,
                canEditKnowledge: true,
            };
        case "case_manager_lead":
            return {
                canManageTeam: false,
                canAssignCases: true,
                canViewAllCases: true,
                canEditKnowledge: false,
            };
        case "case_manager":
            return {
                canManageTeam: false,
                canAssignCases: false,
                canViewAllCases: true,
                canEditKnowledge: false,
            };
        case "case_manager_assistant":
            return {
                canManageTeam: false,
                canAssignCases: false,
                canViewAllCases: true,
                canEditKnowledge: false,
            };
        default:
            return {
                canManageTeam: false,
                canAssignCases: false,
                canViewAllCases: false,
                canEditKnowledge: false,
            };
    }
}
function toContext(member) {
    return {
        userId: member.id,
        email: member.email,
        role: member.role,
        status: member.status,
        permissions: getPermissionsForRole(member.role),
    };
}
function normalizeTeamState(input) {
    if (!input || typeof input !== "object") {
        return createEmptyTeam();
    }
    var team = input;
    return {
        version: typeof team.version === "number" ? team.version : TEAM_VERSION,
        createdAt: typeof team.createdAt === "string" ? team.createdAt : nowIso(),
        updatedAt: typeof team.updatedAt === "string" ? team.updatedAt : nowIso(),
        members: Array.isArray(team.members)
            ? team.members.filter(function (m) { return !!m && typeof m.email === "string"; })
            : [],
        invites: Array.isArray(team.invites)
            ? team.invites.filter(function (i) { return !!i && typeof i.email === "string"; })
            : [],
    };
}
function loadTeamState(firmRoot) {
    return __awaiter(this, void 0, void 0, function () {
        var path, raw, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    path = getTeamPath(firmRoot);
                    if (!(0, fs_1.existsSync)(path)) {
                        return [2 /*return*/, createEmptyTeam()];
                    }
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, promises_1.readFile)(path, "utf-8")];
                case 2:
                    raw = _b.sent();
                    return [2 /*return*/, normalizeTeamState(JSON.parse(raw))];
                case 3:
                    _a = _b.sent();
                    return [2 /*return*/, createEmptyTeam()];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function saveTeamState(firmRoot, team) {
    return __awaiter(this, void 0, void 0, function () {
        var dir, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dir = (0, path_1.join)(firmRoot, TOOL_DIR);
                    return [4 /*yield*/, (0, promises_1.mkdir)(dir, { recursive: true })];
                case 1:
                    _a.sent();
                    next = __assign(__assign({}, team), { version: TEAM_VERSION, updatedAt: nowIso() });
                    return [4 /*yield*/, (0, promises_1.writeFile)(getTeamPath(firmRoot), JSON.stringify(next, null, 2), "utf-8")];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function isInviteActive(invite) {
    if (invite.status !== "pending")
        return false;
    if (!invite.expiresAt)
        return true;
    return new Date(invite.expiresAt).getTime() > Date.now();
}
function expireStaleInvites(team) {
    var changed = false;
    var invites = team.invites.map(function (invite) {
        if (invite.status === "pending" &&
            invite.expiresAt &&
            new Date(invite.expiresAt).getTime() <= Date.now()) {
            changed = true;
            return __assign(__assign({}, invite), { status: "expired" });
        }
        return invite;
    });
    if (!changed)
        return team;
    return __assign(__assign({}, team), { invites: invites });
}
function shouldAutoBootstrapFounder(team, email) {
    if (team.members.length > 0)
        return false;
    if (process.env.DEV_MODE === "true")
        return true;
    if (process.env.CLAUDE_PI_AUTO_BOOTSTRAP === "true")
        return true;
    var founders = getFoundersFromEnv();
    return founders.includes(email);
}
function bootstrapFounderIfAllowed(firmRoot, team, email) {
    return __awaiter(this, void 0, void 0, function () {
        var founder, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!shouldAutoBootstrapFounder(team, email)) {
                        return [2 /*return*/, team];
                    }
                    founder = {
                        id: (0, crypto_1.randomUUID)(),
                        email: email,
                        role: "attorney",
                        status: "active",
                        joinedAt: nowIso(),
                    };
                    next = __assign(__assign({}, team), { members: [founder] });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 1:
                    _a.sent();
                    return [2 /*return*/, next];
            }
        });
    });
}
function findActiveMember(team, email) {
    return team.members.find(function (member) {
        return normalizeEmail(member.email) === email &&
            member.status === "active";
    });
}
function findPendingInvite(team, email) {
    return team.invites.find(function (invite) { return normalizeEmail(invite.email) === email && isInviteActive(invite); });
}
function resolveTeamContext(firmRoot, rawEmail) {
    return __awaiter(this, void 0, void 0, function () {
        var email, team, member, invite, _a, acceptedMember, next;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    email = normalizeEmail(rawEmail);
                    return [4 /*yield*/, loadTeamState(firmRoot)];
                case 1:
                    team = _b.sent();
                    team = expireStaleInvites(team);
                    return [4 /*yield*/, bootstrapFounderIfAllowed(firmRoot, team, email)];
                case 2:
                    team = _b.sent();
                    member = findActiveMember(team, email);
                    if (member) {
                        return [2 /*return*/, { configured: team.members.length > 0, team: team, context: toContext(member) }];
                    }
                    invite = findPendingInvite(team, email);
                    if (!!invite) return [3 /*break*/, 6];
                    _a = team.updatedAt;
                    return [4 /*yield*/, loadTeamState(firmRoot)];
                case 3:
                    if (!(_a !== (_b.sent()).updatedAt)) return [3 /*break*/, 5];
                    return [4 /*yield*/, saveTeamState(firmRoot, team)];
                case 4:
                    _b.sent();
                    _b.label = 5;
                case 5: return [2 /*return*/, { configured: team.members.length > 0, team: team }];
                case 6:
                    acceptedMember = {
                        id: (0, crypto_1.randomUUID)(),
                        email: email,
                        role: invite.role,
                        status: "active",
                        invitedAt: invite.invitedAt,
                        invitedBy: invite.invitedBy,
                        joinedAt: nowIso(),
                    };
                    next = __assign(__assign({}, team), { members: __spreadArray(__spreadArray([], team.members, true), [acceptedMember], false), invites: team.invites.map(function (i) {
                            return i.id === invite.id
                                ? __assign(__assign({}, i), { status: "accepted", acceptedAt: nowIso() }) : i;
                        }) });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 7:
                    _b.sent();
                    return [2 /*return*/, { configured: true, team: next, context: toContext(acceptedMember) }];
            }
        });
    });
}
function requireTeamContext(firmRoot, rawEmail) {
    return __awaiter(this, void 0, void 0, function () {
        var resolved;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, resolveTeamContext(firmRoot, rawEmail)];
                case 1:
                    resolved = _a.sent();
                    if (resolved.context) {
                        return [2 /*return*/, { ok: true, team: resolved.team, context: resolved.context }];
                    }
                    if (!resolved.configured) {
                        return [2 /*return*/, {
                                ok: false,
                                reason: "firm_not_bootstrapped",
                                team: resolved.team,
                            }];
                    }
                    return [2 /*return*/, {
                            ok: false,
                            reason: "invite_required",
                            team: resolved.team,
                        }];
            }
        });
    });
}
function calculateInviteExpiry() {
    return new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
function createTeamInvite(firmRoot, invitedByEmail, inviteEmail, role) {
    return __awaiter(this, void 0, void 0, function () {
        var inviterResult, email, team, existingMember, existingInvite, invite, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, requireTeamContext(firmRoot, invitedByEmail)];
                case 1:
                    inviterResult = _a.sent();
                    if (!inviterResult.ok) {
                        return [2 /*return*/, { ok: false, error: "not_authorized" }];
                    }
                    if (!inviterResult.context.permissions.canManageTeam) {
                        return [2 /*return*/, { ok: false, error: "insufficient_permissions" }];
                    }
                    email = normalizeEmail(inviteEmail);
                    team = inviterResult.team;
                    existingMember = team.members.find(function (m) { return normalizeEmail(m.email) === email && m.status === "active"; });
                    if (existingMember) {
                        return [2 /*return*/, { ok: false, error: "already_member" }];
                    }
                    existingInvite = findPendingInvite(team, email);
                    if (existingInvite) {
                        return [2 /*return*/, { ok: true, invite: existingInvite }];
                    }
                    invite = {
                        id: (0, crypto_1.randomUUID)(),
                        email: email,
                        role: role,
                        status: "pending",
                        invitedBy: normalizeEmail(invitedByEmail),
                        invitedAt: nowIso(),
                        expiresAt: calculateInviteExpiry(),
                    };
                    next = __assign(__assign({}, team), { invites: __spreadArray(__spreadArray([], team.invites, true), [invite], false) });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { ok: true, invite: invite }];
            }
        });
    });
}
function revokeInvite(firmRoot, actorEmail, inviteId) {
    return __awaiter(this, void 0, void 0, function () {
        var actorResult, hasInvite, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, requireTeamContext(firmRoot, actorEmail)];
                case 1:
                    actorResult = _a.sent();
                    if (!actorResult.ok || !actorResult.context.permissions.canManageTeam) {
                        return [2 /*return*/, { ok: false, error: "insufficient_permissions" }];
                    }
                    hasInvite = actorResult.team.invites.some(function (invite) { return invite.id === inviteId; });
                    if (!hasInvite) {
                        return [2 /*return*/, { ok: false, error: "not_found" }];
                    }
                    next = __assign(__assign({}, actorResult.team), { invites: actorResult.team.invites.map(function (invite) {
                            return invite.id === inviteId ? __assign(__assign({}, invite), { status: "revoked" }) : invite;
                        }) });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { ok: true }];
            }
        });
    });
}
function updateMemberRole(firmRoot, actorEmail, memberId, role) {
    return __awaiter(this, void 0, void 0, function () {
        var actorResult, member, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, requireTeamContext(firmRoot, actorEmail)];
                case 1:
                    actorResult = _a.sent();
                    if (!actorResult.ok || !actorResult.context.permissions.canManageTeam) {
                        return [2 /*return*/, { ok: false, error: "insufficient_permissions" }];
                    }
                    member = actorResult.team.members.find(function (m) { return m.id === memberId; });
                    if (!member) {
                        return [2 /*return*/, { ok: false, error: "not_found" }];
                    }
                    next = __assign(__assign({}, actorResult.team), { members: actorResult.team.members.map(function (m) {
                            return m.id === memberId ? __assign(__assign({}, m), { role: role }) : m;
                        }) });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { ok: true }];
            }
        });
    });
}
function listTeamForUser(firmRoot, actorEmail) {
    return __awaiter(this, void 0, void 0, function () {
        var actorResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, requireTeamContext(firmRoot, actorEmail)];
                case 1:
                    actorResult = _a.sent();
                    if (!actorResult.ok) {
                        return [2 /*return*/, { ok: false, error: actorResult.reason, team: actorResult.team }];
                    }
                    return [2 /*return*/, {
                            ok: true,
                            context: actorResult.context,
                            team: actorResult.team,
                        }];
            }
        });
    });
}
function ensureTeamMember(firmRoot, rawEmail, role) {
    return __awaiter(this, void 0, void 0, function () {
        var email, team, existing, member, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    email = normalizeEmail(rawEmail);
                    return [4 /*yield*/, loadTeamState(firmRoot)];
                case 1:
                    team = _a.sent();
                    team = expireStaleInvites(team);
                    existing = findActiveMember(team, email);
                    if (existing) {
                        return [2 /*return*/, { team: team, context: toContext(existing) }];
                    }
                    member = {
                        id: (0, crypto_1.randomUUID)(),
                        email: email,
                        role: role,
                        status: "active",
                        joinedAt: nowIso(),
                        invitedBy: "remote_sync",
                    };
                    next = __assign(__assign({}, team), { members: __spreadArray(__spreadArray([], team.members, true), [member], false) });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { team: next, context: toContext(member) }];
            }
        });
    });
}
function bootstrapTeamFounder(firmRoot, rawEmail) {
    return __awaiter(this, void 0, void 0, function () {
        var email, team, existingMember, founder, next;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    email = normalizeEmail(rawEmail);
                    return [4 /*yield*/, loadTeamState(firmRoot)];
                case 1:
                    team = _a.sent();
                    existingMember = findActiveMember(team, email);
                    if (existingMember) {
                        return [2 /*return*/, { ok: true, team: team, context: toContext(existingMember) }];
                    }
                    if (team.members.length > 0) {
                        return [2 /*return*/, { ok: false, reason: "already_configured" }];
                    }
                    founder = {
                        id: (0, crypto_1.randomUUID)(),
                        email: email,
                        role: "attorney",
                        status: "active",
                        joinedAt: nowIso(),
                    };
                    next = __assign(__assign({}, team), { members: [founder] });
                    return [4 /*yield*/, saveTeamState(firmRoot, next)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, { ok: true, team: next, context: toContext(founder) }];
            }
        });
    });
}
