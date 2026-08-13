# Wikidata collection give-back

This small tool helps Gesso find museum objects that have an object ID in Wikidata but are missing the matching collection statement. Filling carefully verified gaps can help address the systemic under-linking of non-Western museum objects in Wikidata. That is a genuine contribution back to the shared Wikimedia commons that Gesso benefits from.

The script only reads Wikidata and creates a local QuickStatements file. It never logs in or edits Wikidata. Kat makes every edit manually in her browser with her own Wikidata account.

## P195, not P276

Use **P195 (collection)** to say that an artwork is in a museum's collection. **P276 (location)** describes physical location and is secondary. An object can move galleries or go off display while remaining in the same collection, so P276 is not a substitute for P195.

The useful gap is therefore:

1. The item has a museum's object-ID property.
2. The item does not have `P195` pointing to that museum's collection QID.

## Why the Met is not the target

The Met's object-ID property is P3634 and its museum item is Q160236. Of 71,663 relevant items, 71,659 already have `P195=Q160236`. The Met is essentially complete and is a model of a museum that already made a good Wikidata upload. Do not target it for bulk additions.

Instead, run the tool with other museums' verified object-ID properties and collection QIDs to discover where meaningful gaps exist. Do not guess either ID.

## Generate a test batch

From the repository root, run:

```sh
node scripts/wikidata-giveback.mjs <objectIdProperty> <collectionQID> [--limit N]
```

The default limit is 5. The script prints the total number of gaps, fetches the first test items, and writes:

```text
data/incoming/giveback/<collectionQID>-testbatch.txt
```

Wikidata may occasionally time out or return HTTP 429 while busy. The script retries with backoff and prints a friendly status message.

## TINY-TEST-BATCH-FIRST protocol

1. Verify the museum object-ID property and collection QID on Wikidata.
2. Run the script with its default batch size of 5.
3. Inspect all five items and every proposed reference in the generated TSV.
4. Sign in to [QuickStatements](https://quickstatements.toolforge.org/) with Kat's Wikidata account and load the five lines.
5. Submit only that tiny batch. Then open all five items on Wikidata and verify the edits by hand, including their references.
6. Do not scale up until all five are correct. If anything looks wrong, stop and fix the query or references first.
7. For later batches, keep them modest, watch errors and warnings, pause between batches, and follow Wikidata edit-rate etiquette. Quality matters more than speed.

## References

Every generated QuickStatements v1 line includes a reference on the same tab-separated line. When the object-ID property has a P1630 formatter URL, the script turns the museum object ID into an object-page URL and adds it with `S854` (reference URL):

```text
<item QID>    P195    <collection QID>    S854    "<museum object URL>"
```

The actual file uses tabs, not spaces. If a verified Wikidata item exists for the museum catalog or database, `S248` (stated in) can also point to that source item. Verify its QID rather than guessing it.

If the property has no usable formatter URL, the script falls back to `S143 Q2013` (imported from Wikidata) and prints a TODO warning. Treat that as a placeholder. Replace it with a stronger museum catalog source or a verified object URL before any scale-up.

## Kat's Wikidata contributions

Kat can keep this table as the public-minded project log for statements she personally contributed to Wikidata/Wikimedia during Gesso.

| date | museum | property added | # statements | QuickStatements batch URL | notes |
| --- | --- | --- | ---: | --- | --- |
|  |  |  |  |  |  |
