---
description: "Identity V4-to-V5 Session conversion, widened producer-source admission, and native V5 validation."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore released V4 Sessions as V5 without changing their events. This page specifies the edge's identity conversion, preserved coordinates and inherited cuts, delivery-generation refusal, and native V5 admission. Persistence owns file reads and successor publication; this library owns conversion and target rules.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 specification](#v4-to-v5-specification)
  - [Header and physical framing](#header-and-framing)
  - [Body conversion](#body-conversion)
  - [Sequence references and inheritance](#sequence-references)
  - [Delivery generations](#delivery-guards)
  - [Source audit and refusal](#source-audit)
- [Native V5 admission](#native-v5-admission)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the [catalog](../session-format-catalog/README.md) for complete restoration. Direct imports serve catalog assembly and tests; this library has no Cordis mount configuration. Its [public exports](src/index.ts) provide the adjacent migration, the released V4 source codec, the V5 codec, and target validators. The source codec remains owned by [V3-to-V4](../session-format-v3-to-v4/README.md).

Header-only migration validates and advances metadata without reading the body:

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

Every restore creates independent stage state, and `finish()` derives a seeded Session's inherited cut from its tagged marker. The [format protocol](../session-format/README.md) owns scheduling and error handling; [JSONL persistence](../session-persistence-jsonl/README.md) owns source reads, preparation, and verified exclusive successor publication.

-----

<a id="v4-to-v5-specification"></a>
## V4-to-V5 specification

V5 widens only the declared producer-source vocabulary that native V4 admission already accepts as producer-owned kinds; no stored V4 event used those kinds, so the body conversion is an identity conversion. This edge retains every admitted source event, its payload, its message identities, its surface metadata, and all coordinates. It creates no events, rewrites no references, and renames no fields. Earlier V0–V3 inputs first pass through their existing edges to V4; those edges retain their own transformations and refusal policies.

<a id="header-and-framing"></a>
### Header and physical framing

| Input | V5 result | Preservation or refusal |
|---|---|---|
| Logical V4 header | `version: 4` becomes `5` | Released V4 header validation runs first; all other logical header fields remain unchanged. |
| V4 physical rows | Released V4 source codec decodes events and compact runs | Source framing and source-event range decoding remain owned by the preceding package. |
| V5 physical rows | `releasedV5SessionFormatCodec` reuses released V4 framing with unchanged native admission | No V5 event is projected into a V4 semantic validator. Encoding and decoding do not run this incoming migration. |

No preset id, file attachment, or physical filename is renamed by this edge.

<a id="body-conversion"></a>
### Body conversion

Every decoded source event is emitted unchanged as the same object, including unknown ignorable records with their opaque payloads and surface metadata. No event type is namespaced: V4 admission already rejects retired native forms, and the V5 vocabulary contains no addition that requires historical reinterpretation. Producer-source kinds new in V5 — `output-limit-continuation`, `pentest-executor`, `pentest-supervisor`, and `recon-engine` — appear only in events written at V5; a V4 source artifact cannot contain them, and the conversion does not mint them.

<a id="sequence-references"></a>
### Sequence references and inheritance

Identity conversion keeps every sequence number, so all references, surface coordinates, delivery coordinates, and inherited positions remain valid without remapping. For a seeded Session, the last `session/end-seed` carrying `inherited: true` identifies the inherited event count, excluding that marker, and the target count equals the source count. Unseeded stages expose zero before EOF; seeded stages leave the count unknown until `finish()`. A supplied source cut must agree with that marker position. Untagged markers do not define fork inheritance.

<a id="delivery-guards"></a>
### Delivery generations

| Delivery record | Admission and preservation |
|---|---|
| V4 source marker claiming generation 5 | Refuse: advancing the header must not activate a target-generation watermark. |
| V4 source marker for generation 4 | Require a nonempty Session id and nonnegative safe-integer `throughSeq` before the marker; a foreign id is allowed only before the inherited cut with `parentSession`. |
| Other source generations, including values above 5 | Retain their event type and payload coordinates unchanged; they remain inactive in V5. |
| Native V5 marker for generation 5 | Apply the same earlier-coordinate and Session-ownership checks using V5 as current. |
| Native V5 historical marker, including generation 4 | Retain recorded coordinates and identity; it is not a V5 acceptance watermark. |

No delivery payload or event type is rewritten. Higher-version migrations own any future activation checks; this edge checks only promotion to V5.

<a id="source-audit"></a>
### Source audit and refusal

V4 physical decoding and header validation run before the stage. The stage checks dense marker positions only implicitly through target validation, source cuts, and delivery ownership as specified above. It does not run the complete released V4 semantic restorer on the source. Complete restoration additionally applies the V5 target rules below; physical parsing, stage conversion, and target restoration are distinct checks.

A direct stage can raise `SessionFormatError` for malformed data or `SessionFormatUnsupportedMigrationError` when a preserving conversion is unavailable. The catalog wraps stage failures as unsupported migration; transformed-target failures receive that classification as well. Strict current validation reports its target failure directly. Physical corruption follows the chosen decoder recovery policy. No prefix is a completed restore, and a refusal does not authorize source mutation, a partial successor, or generation fallback.

-----

<a id="native-v5-admission"></a>
## Native V5 admission

An input already marked V5 never runs V4→V5. Native validation preserves recorded events and returns the same artifact; it does not synthesize history. Native V5 admission equals released V4 admission: [row admission](src/codec.ts) delegates to the released V4 checks before recoverable suffix suppression, and [artifact restoration](src/validation.ts) reuses the released V4 field and relationship validators with V5 header identity and generation-5 delivery ownership. The [V3-to-V4 specification](../session-format-v3-to-v4/README.md#native-v4-admission) therefore owns the complete native field, message, and relationship catalog — exact header fields, envelope and surface rules, producer attribution with its open producer-owned vocabulary, developer bindings, fork results, and lifecycle relationships — with the differences below.

| Data | Native V5 rule |
|---|---|
| Logical header | Identical fields and checks with `version` exactly `5`. |
| Producer attribution | The declared V5 producer kinds are ordinary producer-owned kinds: readers preserve their JSON metadata, impose no validation, replay, or authority requirement, and consumers fall through kinds they do not project. |
| Delivery generations | Generation-5 markers are active watermarks with Session-ownership checks; generation-4 and earlier markers are historical records retained unchanged. |

The frozen `RELEASED_V4_EVENT_TYPES` set lists the event names the released V4 reader understands — the released V3 vocabulary plus `developer/message` — for fixed-generation prerequisite readers. It does not inherit additions from the installed writer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The migration declaration creates independent streaming stages that emit each source event unchanged while observing the inherited marker and delivery generations. The V5 codec wraps the released V4 codec for physical framing, header decoding, and row admission, and stamps the V5 version on decoded and encoded headers. The target restorer reuses the released V4 field and relationship validators and validates generation-5 delivery ownership. No runtime invariant companion is published because each completed operation validates its result and stages never share state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Format version and release status](../../../docs/session-format-status.md) — checkout writer and published format authority.
- [Adding a Session format version](../../../docs/cookbook/adding-a-session-format-version.md) — adjacent-edge integration and validation.
- [JSONL persistence](../session-persistence-jsonl/README.md) — immutable generation selection and publication.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

Historical requests retain their recorded messages and model configuration. The identity conversion adds no model-visible content, and restored events reconstruct the same `type`, `seq`, and `time` coordinates as their V4 source.

#### Token effect

The conversion changes no request text or token-bearing data.

#### KV Cache effect

The edge preserves the recorded request prefix. Provider cache availability and eviction remain outside this library.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Accepted V4 transition** — the [checkpoint](../../../docs/session-format-status.md#finalization-record) protects the accepted history. Backward-compatible additions can remain V4 through new acknowledgements; breaking changes require a successor. Already-written V4 files do not rerun this incoming edge, and historical inputs remain intact.
- **Fixed-generation V4 prerequisite readers** — consumers that read V4 child evidence for the V3→V4 edge bind the fixed V4 catalog instead of the installed writer catalog, so their results do not vary with the checkout writer.
- **Future delivery generations** — V5 keeps predecessor markers inactive. Activating generation 6 requires the next adjacent edge, and a V4 source claiming generation 5 is refused.
- **Producer attribution is not authority** — the widened kinds carry no runtime permission. A producer may inspect its own kind to resume duplicate suppression; other readers must preserve and derive the recorded messages without that projection.
- **Source refusal follows the released V4 codec** — this edge adds no source admission of its own. A form the V4 codec refuses at decode time refuses here without a V5 successor.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
