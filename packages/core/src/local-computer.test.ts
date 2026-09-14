import { describe, expect, it } from "vitest";
import {
  assertNotHomeRoot,
  isHomeDirectoryShare,
  isInsideLocalRoot,
  LOCAL_COMPUTER_HOME_ROOT_MESSAGE,
  LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE,
  localComputerFolderName,
  resolveLocalRelativePath,
  unattendedRunUsesCloudComputer,
} from "./local-computer.js";

describe("local computer helpers", () => {
  it("names a folder from its path", () => {
    expect(localComputerFolderName("/Volumes/disk/project")).toBe("project");
    expect(localComputerFolderName("/")).toBe("folder");
  });

  it("refuses the home directory as the shared root", () => {
    expect(() => assertNotHomeRoot("/Users/owner", "/Users/owner")).toThrow(
      LOCAL_COMPUTER_HOME_ROOT_MESSAGE,
    );
    expect(() => assertNotHomeRoot("/Users/owner/src", "/Users/owner")).not.toThrow();
    expect(isHomeDirectoryShare("/Users/owner", "/Users/owner")).toBe(true);
    expect(isHomeDirectoryShare("/Users/owner/src", "/Users/owner")).toBe(false);
  });

  it("keeps relative paths inside the shared folder", () => {
    expect(resolveLocalRelativePath("/tmp/share", "notes/a.txt")).toBe("/tmp/share/notes/a.txt");
    expect(resolveLocalRelativePath("/tmp/share", "")).toBe("/tmp/share");
    expect(() => resolveLocalRelativePath("/tmp/share", "../etc/passwd")).toThrow(
      LOCAL_COMPUTER_PATH_ESCAPE_MESSAGE,
    );
    expect(isInsideLocalRoot("/tmp/share/a", "/tmp/share")).toBe(true);
    expect(isInsideLocalRoot("/tmp/share-other", "/tmp/share")).toBe(false);
  });

  it("sends routines and webhooks to the cloud computer", () => {
    expect(unattendedRunUsesCloudComputer("routine")).toBe(true);
    expect(unattendedRunUsesCloudComputer("webhook")).toBe(true);
    expect(unattendedRunUsesCloudComputer("user")).toBe(false);
    expect(unattendedRunUsesCloudComputer("messaging")).toBe(false);
  });
});
