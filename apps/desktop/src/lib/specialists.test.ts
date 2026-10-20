import { describe, expect, it } from "vitest";
import { connectorCollisions, connectorPrefix, MAX_ID, specialistId } from "./specialists";

describe("specialistId", () => {
  it("turns a typed name into the id it is saved under", () => {
    expect(specialistId("Stats reviewer")).toBe("stats-reviewer");
    expect(specialistId("  Release notes — writer!! ")).toBe("release-notes-writer");
    expect(specialistId("Café Ölçüm")).toBe("cafe-olcum");
    expect(specialistId("R2D2")).toBe("r2d2");
  });

  it("yields nothing for a name without Latin letters or digits", () => {
    expect(specialistId("统计审稿人")).toBe("");
    expect(specialistId("---")).toBe("");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const id = specialistId(`${"a".repeat(MAX_ID - 1)} b`);
    expect(id.length).toBeLessThanOrEqual(MAX_ID);
    expect(id.endsWith("-")).toBe(false);
  });
});

describe("connectors", () => {
  it("prefixes match the runtime's tool-name sanitizer", () => {
    expect(connectorPrefix("my server.v2")).toBe("my_server_v2");
    expect(connectorPrefix("open-science-browser")).toBe("open-science-browser");
  });

  it("flags a block that would also catch another connector's tools", () => {
    expect(connectorCollisions(["pubmed"], ["pubmed_central", "arxiv"])).toEqual([
      ["pubmed", "pubmed_central"],
    ]);
    expect(connectorCollisions(["pubmed"], ["pubmed-central"])).toEqual([]);
    expect(connectorCollisions(["pubmed_central"], ["pubmed"])).toEqual([]);
  });
});
