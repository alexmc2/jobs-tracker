import { describe, expect, it } from "vitest";
import {
  sanitizeDiscoveryLocations,
  sanitizeDiscoverySearchTerms,
} from "./discovery-inputs";

describe("discovery input sanitizers", () => {
  it("drops standalone low-signal search tags and keeps full role queries", () => {
    expect(
      sanitizeDiscoverySearchTerms([
        "backend developer",
        "remote",
        "APIs",
        "React",
        "python developer",
        "QA",
      ]),
    ).toEqual({
      accepted: ["backend developer", "python developer", "qa"],
      dropped: ["remote", "APIs", "React"],
    });
  });

  it("drops pseudo-locations like remote from city filters", () => {
    expect(
      sanitizeDiscoveryLocations(["Brighton", "remote", "Hybrid", "London"]),
    ).toEqual({
      accepted: ["Brighton", "London"],
      dropped: ["remote", "Hybrid"],
    });
  });
});
