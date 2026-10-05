// src/ai/surfaces.ts: what the floating assistant may do on each page. The surface is resolved on the
// server because the client's claim is untrusted: a widget must not widen its own capabilities by
// sending a different surface name. Also pins the boundaries from docs/architecture-rules.md that
// scripts/check-route-surfaces.ts does not: reports are final, prompt changes need approval, and the
// unattended questions surface cannot reach outside the system. (That script covers registry and
// skill-coverage consistency.)
import { describe, expect, test } from "bun:test";
import { EVERYWHERE_SKILLS, INTERACTIVE_SKILLS, SURFACES, SURFACES_LIST, isSkillAllowed, isSurface, resolveSurface, surfaceForRoute } from "../src/ai/surfaces";

describe("surfaceForRoute", () => {
  test("maps each page family to its surface", () => {
    const cases: [string, string][] = [
      ["/notes", "notes"],
      ["/notes/abc", "notes"],
      ["/questions", "questions"],
      ["/context-builder", "context"],
      ["/chat", "context"],
      ["/rules", "context"],
      ["/contacts", "context"],
      ["/entities", "entities"],
      ["/entities/some-name", "entities"],
      ["/sources", "sources"],
      ["/sources/Some%20Source", "sources"],
      ["/", "report"],
      ["/2026-10-05", "report"],
      ["/2026-10-05/item/abc", "report"],
    ];
    for (const [route, surface] of cases) expect([route, surfaceForRoute(route)]).toEqual([route, surface]);
  });

  test("ignores a query string and treats an empty route as the home page", () => {
    expect(surfaceForRoute("/notes?q=tax")).toBe("notes");
    expect(surfaceForRoute("/2026-10-05?item=3")).toBe("report");
    expect(surfaceForRoute("")).toBe("report");
    expect(surfaceForRoute("/?x=1")).toBe("report");
  });

  test("a route nobody mapped falls back to the least privileged surface, global", () => {
    for (const route of ["/runs", "/skills", "/settings", "/setup", "/nonsense", "/2026-10", "/not-a-date/x"]) {
      expect([route, surfaceForRoute(route)]).toEqual([route, "global"]);
    }
  });
});

describe("resolveSurface: the client cannot widen its own capabilities", () => {
  test("a claim that agrees with the route is accepted", () => {
    expect(resolveSurface("notes", "/notes")).toBe("notes");
    expect(resolveSurface("global", "/runs")).toBe("global");
  });

  test("a claim that disagrees with the route loses to the route", () => {
    expect(resolveSurface("questions", "/")).toBe("report");
    expect(resolveSurface("context", "/runs")).toBe("global");
    expect(resolveSurface("global", "/notes")).toBe("notes");
  });

  test("a claim that is not a surface, or is missing, is ignored", () => {
    for (const claimed of ["admin", "", "__proto__", "constructor", undefined, null, 5, {}, ["notes"]]) {
      expect(resolveSurface(claimed, "/entities")).toBe("entities");
    }
  });

  test("isSurface accepts exactly the listed surfaces", () => {
    for (const name of SURFACES_LIST) expect(isSurface(name)).toBe(true);
    for (const value of ["Notes", "toString", "", 1, null, undefined]) expect(isSurface(value)).toBe(false);
  });
});

describe("isSkillAllowed", () => {
  test("a skill is allowed only on the surfaces that list it", () => {
    expect(isSkillAllowed("notes", "update_note")).toBe(true);
    expect(isSkillAllowed("sources", "update_note")).toBe(false);
    expect(isSkillAllowed("sources", "set_source_active")).toBe(true);
    expect(isSkillAllowed("global", "set_source_active")).toBe(false);
    expect(isSkillAllowed("global", "does_not_exist")).toBe(false);
  });
});

describe("the boundaries", () => {
  test("every surface is defined and has a label and hints that end in a space, ready to be finished", () => {
    expect(Object.keys(SURFACES).sort()).toEqual([...SURFACES_LIST].sort());
    for (const [name, def] of Object.entries(SURFACES)) {
      expect([name, def.label.length > 0, def.prompt.length > 0]).toEqual([name, true, true]);
      expect(def.hints.length).toBeGreaterThan(0);
      for (const hint of def.hints) expect([name, hint.endsWith(" ")]).toEqual([name, true]);
    }
  });

  test("every surface carries the everywhere skills, and no surface lists a skill twice", () => {
    for (const [name, def] of Object.entries(SURFACES)) {
      for (const skill of EVERYWHERE_SKILLS) expect([name, skill, def.skills.includes(skill)]).toEqual([name, skill, true]);
      expect([name, new Set(def.skills).size]).toEqual([name, def.skills.length]);
    }
  });

  test("reports are final: no surface has a skill that writes a report, and the briefing page cannot edit notes", () => {
    for (const def of Object.values(SURFACES)) {
      expect(def.skills.filter((s) => /report/.test(s))).toEqual(["read_report"]);
    }
    for (const skill of ["update_note", "delete_note", "restore_note"]) expect(isSkillAllowed("report", skill)).toBe(false);
    expect(SURFACES.report.notice).toContain("Reports are final");
  });

  test("a prompt change is only ever proposed from the global surface, which queues it for approval", () => {
    for (const name of SURFACES_LIST) expect([name, isSkillAllowed(name, "propose_prompt_version")]).toEqual([name, name === "global"]);
    expect(SURFACES_LIST.some((name) => SURFACES[name].skills.some((s) => /^(set|apply|publish|activate)_prompt/.test(s)))).toBe(false);
  });

  test("the questions surface runs unattended on untrusted mail, so it cannot mail anyone or write a file", () => {
    for (const skill of INTERACTIVE_SKILLS) expect(isSkillAllowed("questions", skill)).toBe(false);
    for (const name of SURFACES_LIST.filter((n) => n !== "questions")) {
      for (const skill of INTERACTIVE_SKILLS) expect([name, skill, isSkillAllowed(name, skill)]).toEqual([name, skill, true]);
    }
  });
});
