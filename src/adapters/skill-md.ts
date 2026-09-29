/**
 * SKILL.md path references found inside tool arguments.
 * Used by adapters whose agents have no dedicated Skill tool — reading the
 * skill file is the only trace a trigger leaves.
 */
/** Single-segment skill directory names, e.g. ~/.claude/skills/foo/SKILL.md. */
export const SKILL_MD_PATH_RE = /\/skills\/([^/\s"'\\]+)\/SKILL\.md/;

/** Tolerates nested skill directories, e.g. ~/.agents/skills/document-skills/docx/SKILL.md. */
export const SKILL_MD_PATH_NESTED_RE = /\/skills\/((?:[^/\s"'\\]+\/)*[^/\s"'\\]+)\/SKILL\.md/;
