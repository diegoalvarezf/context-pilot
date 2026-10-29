import { describe, expect, it } from "vitest";
import { getLanguageForFile } from "../src/indexer/languages.js";
import { parseFile, parsesOutOfProcess } from "../src/indexer/parse.js";
import { signatureOf } from "../src/symbols/extract.js";

const SWIFT = `import SwiftUI

@MainActor
final class Store: ObservableObject {
    @Published var items: [Item] = []
    init(items: [Item]) { self.items = items }
    func save() async throws {}
    private func reset() {}
}

struct RootView: View {
    var body: some View { Text("hi") }
}

enum Mood { case happy, sad }

protocol Saving {
    func save() async throws
}

extension Store.Item {
    func label() -> String { "" }
}

typealias Handler = (Int) -> Void
fileprivate func helper() {}
`;

const CSHARP = `using System;
namespace App.Audio;

[StructLayout(LayoutKind.Sequential)]
public struct PropertyKey
{
    public PropertyKey(Guid id) { Id = id; }
    public Guid Id;
}

public interface IDevice
{
    string GetId();
}

internal sealed class DeviceWatcher : IDevice
{
    public string GetId() => "x";
    private void Poll() {}
}

public enum Flow { Render, Capture }
public record Sample(int Rate);
public delegate void Changed(string id);
`;

const parse = (lang: "swift" | "csharp", source: string) => parseFile({ lang, source, fileId: "f" });
const defs = (r: Awaited<ReturnType<typeof parse>>) =>
  r!.symbols.map((s) => `${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}${s.exported ? "" : " (private)"}`);

describe("Swift and C# symbols", () => {
  it("maps file extensions", () => {
    expect(getLanguageForFile("Sources/App/RootView.swift")).toBe("swift");
    expect(getLanguageForFile("src/Audio/Device.cs")).toBe("csharp");
  });

  it("parses big grammars out of process only where Node needs it", () => {
    const major = Number(process.versions.node.split(".")[0]);
    expect(parsesOutOfProcess("swift")).toBe(major >= 25);
    expect(parsesOutOfProcess("typescript")).toBe(false);
  });

  it("extracts Swift types, methods, protocols and extension methods", async () => {
    const r = await parse("swift", SWIFT);
    expect(defs(r)).toEqual([
      "class Store",
      "method Store.init",
      "method Store.save",
      "method Store.reset (private)",
      "class RootView",
      "enum Mood",
      "interface Saving",
      "method Saving.save",
      "method Item.label",
      "type Handler",
      "function helper (private)",
    ]);
    const store = r!.symbols.find((s) => s.name === "Store")!;
    expect(store.signature).toBe("final class Store: ObservableObject");
    expect([store.startLine, store.endLine]).toEqual([3, 9]);
    expect(r!.refs.some((x) => x.name === "Item")).toBe(true);
  });

  it("extracts C# types, constructors, methods, records and delegates", async () => {
    const r = await parse("csharp", CSHARP);
    expect(defs(r)).toEqual([
      "class PropertyKey",
      "method PropertyKey.PropertyKey",
      "interface IDevice",
      "method IDevice.GetId",
      "class DeviceWatcher",
      "method DeviceWatcher.GetId",
      "method DeviceWatcher.Poll (private)",
      "enum Flow",
      "class Sample",
      "type Changed",
    ]);
    expect(r!.symbols[0].signature).toBe("public struct PropertyKey");
    expect(r!.chunks.length).toBeGreaterThan(0);
  });

  it("drops leading attributes from signatures", () => {
    expect(signatureOf("@MainActor\nfinal class A {")).toBe("final class A");
    expect(signatureOf("@objc(foo) func bar() {")).toBe("func bar()");
    expect(signatureOf('[DllImport("x")]\n[return: MarshalAs(1)]\npublic static extern int F();')).toBe("public static extern int F();");
    expect(signatureOf("export function f() {")).toBe("export function f()");
  });
});
