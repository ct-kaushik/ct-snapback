# Building Snapback CSVs with AI — Prompt Pack

Copy-paste prompts for turning a product spreadsheet (or raw product notes) into **Coalition Snapback's CSV format**, using ChatGPT (or any capable LLM). Paired with [USER_GUIDE.md](USER_GUIDE.md) → *Edit-and-reupload*.

There are two prompts:

- **Prompt A — Products** → generates `products.csv`, `variants.csv`, `product_images.csv`, `inventory_levels.csv`, `metafields.csv`
- **Prompt B — Collections** → generates `collections.csv`, `collection_products.csv`

---

## How to use these prompts

1. **Run Prompt A first, Prompt B second** (collections reference product handles).
2. **Fill the placeholders** at the bottom of each prompt:
   - `[PASTE YOUR PRODUCTS HERE …]` — your source data (or attach a spreadsheet).
   - Your store's **location name** (Prompt A) — find it in `locations.csv` (this store: **`Shop location`**).
3. **Attach your existing CSVs as format samples.** Drag your current `products.csv` + `variants.csv` into the ChatGPT chat and add: *"Match the exact format of these attached files."* This anchors the output to real data.
4. **Work in batches of 5–10 products.** Long CSV generations are where an LLM drifts from the format.
5. **Fold the output into your backup:**
   - **Append** the generated rows (not the header) into the matching files in your backup folder — keep existing rows.
   - Put any local images in `images/` (or use public `src` URLs — the prompts use URLs).
   - **Zip the *contents* of the folder** (CSVs + `images/` at the zip **root** — never zip the parent folder).
   - In Snapback → **Restore** → upload the zip → **dry-run** → restore.

> ⚠️ **Validate before the real run.** Every `product_handle` referenced in variants / images / inventory / metafields / collection membership must exist in `products.csv`. A dry-run plus the per-run log will catch mismatches.

---

## Prompt A — Products, variants, images, inventory, metafields

```text
You are a Shopify data-migration assistant. Convert the product data I provide at the
bottom into the CSV files used by "Coalition Snapback" (a Shopify backup/restore tool).
I will append your output to an existing backup and restore it into my store, so the
format must match EXACTLY.

OUTPUT: produce these 5 files, each as a separate downloadable .csv AND shown inline in
its own labeled section. Use the EXACT header row and column order given. Output ONLY the
new products I provide (one set of rows per product) — do not include my existing products.

======================= FILE 1 — products.csv =======================
Header (exact): id,handle,title,description_html,vendor,product_type,tags,status,template_suffix,category_id,category_name,seo_title,seo_description,options_json
- id: LEAVE BLANK (new product; Snapback assigns it).
- handle: unique, lowercase, hyphenated. THIS IS THE JOIN KEY used by every other file.
- tags: a JSON array string, e.g. ["high-protein","dinner"]  (NOT a plain comma list).
- status: one of ACTIVE | DRAFT | ARCHIVED (uppercase).
- category_id/category_name/template_suffix/seo_*: blank unless I give them.
- options_json: JSON array of the product's options, e.g.
    [{"name":"Size","position":1,"values":["Regular","Large"]}]
  If a product has NO real variants/options, use exactly:
    [{"name":"Title","position":1,"values":["Default Title"]}]

======================= FILE 2 — variants.csv =======================
Header (exact): id,product_handle,sku,title,option_values_json,price,compare_at_price,cost,barcode,inventory_policy,taxable,tax_code,position,weight_value,weight_unit
- id: LEAVE BLANK. product_handle: must equal the product's handle in FILE 1.
- One row per variant. For a product with no options, make ONE variant row with
  title "Default Title" and option_values_json [{"name":"Title","value":"Default Title"}].
- option_values_json: JSON array, e.g. [{"name":"Size","value":"Regular"}]
- price/compare_at_price/cost: plain numbers as strings (e.g. 12.99). compare_at_price blank if none.
- inventory_policy: DENY (stop selling at 0) or CONTINUE (allow overselling). Uppercase.
- taxable: true or false. position: 1,2,3… weight_value: number; weight_unit: GRAMS | KILOGRAMS | OUNCES | POUNDS.
- barcode/tax_code: blank unless I give them.

======================= FILE 3 — product_images.csv =======================
Header (exact): product_handle,position,src,alt,media_id,filename,file
- One row per image. product_handle must match FILE 1. position: 1,2,3…
- src: a PUBLIC https image URL (Snapback/Shopify downloads it on restore).
- alt: short description. Leave media_id, filename, and file BLANK.

======================= FILE 4 — inventory_levels.csv =======================
Header (exact): variant_id,inventory_item_id,product_handle,variant_sku,option_values,location_name,tracked,on_hand,available,committed,incoming,reserved,damaged,safety_stock,quality_control
- One row per variant. Leave variant_id and inventory_item_id BLANK.
- product_handle + variant_sku must match FILE 2. option_values: same JSON as the variant's option_values_json.
- location_name: use exactly  Shop location
- tracked: true. on_hand: the stock number (do not leave blank — a blank is treated as 0).
  Leave available/committed/incoming/reserved/damaged/safety_stock/quality_control BLANK.

======================= FILE 5 — metafields.csv =======================
Header (exact): owner_type,owner_key,namespace,key,type,value
- One row per metafield value per product.
- owner_type: PRODUCT  (use PRODUCTVARIANT only for a per-variant metafield, COLLECTION for a collection).
- owner_key:
    PRODUCT        -> the product's handle
    PRODUCTVARIANT -> handle::SKU   (e.g. grilled-salmon-bowl::SALMON-REG)
    COLLECTION     -> the collection's handle
- namespace, key, type: use ONLY an entry from the CATALOG below, copied exactly.
- Do NOT create metafields that aren't in the catalog (they have no definition and won't stick).

ALLOWED METAFIELD CATALOG (namespace.key  ->  type):
  PRODUCT, fill these as needed:
    custom.ingredients                          -> rich_text_field
    custom.product_card_subtitle                -> rich_text_field
    custom.meal_pack_url                        -> url
    custom.elevated_protein_pack_calories       -> single_line_text_field
    custom.elevated_protein_pack_carbs          -> single_line_text_field
    custom.elevated_protein_pack_fats           -> single_line_text_field
    custom.elevated_protein_pack_protein        -> single_line_text_field
    custom.balanced_nutrition_pack_calories     -> single_line_text_field
    custom.balanced_nutrition_pack_carbs        -> single_line_text_field
    custom.balanced_nutrition_pack_fats         -> single_line_text_field
    custom.balanced_nutrition_pack_protein      -> single_line_text_field
  DO NOT OUTPUT these (reference/app-managed — handled separately):
    custom.*_nutritional_facts_image  (file_reference — needs an uploaded image GID)
    reviews.rating / reviews.rating_count       (managed by the reviews app)
    mm-google-shopping.*                        (managed by the Google app)
    shopify--discovery--*                       (Shopify-managed)

VALUE FORMAT BY TYPE:
  single_line_text_field : plain text, e.g.  683   or   32g protein
  multi_line_text_field  : plain text (newlines allowed)
  url                    : a full https URL
  number_integer         : a whole number as text, e.g. 5
  rich_text_field        : a Shopify rich-text JSON document. For a simple paragraph use:
       {"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"YOUR TEXT"}]}]}
  rating                 : JSON, e.g. {"scale_min":"1.0","scale_max":"5.0","value":"4.8"}

======================= CSV ENCODING RULES (critical) =======================
- UTF-8, comma-delimited, with the header row.
- Any field containing a comma, a quote, or JSON MUST be wrapped in double quotes, and
  every internal double quote MUST be doubled. So the JSON  [{"name":"Size","value":"Regular"}]
  is written in the cell as  "[{""name"":""Size"",""value"":""Regular""}]"
- Keep the same handle across all files for a given product.
- Do NOT invent data. If something required (like variant options or price) is missing or
  ambiguous, STOP and ask me instead of guessing.

======================= WORKED EXAMPLE (one 2-variant product) =======================
products.csv:
id,handle,title,description_html,vendor,product_type,tags,status,template_suffix,category_id,category_name,seo_title,seo_description,options_json
,grilled-salmon-bowl,Grilled Salmon Bowl,<p>Wild-caught salmon with jasmine rice.</p>,Meal Preps 4 Fuel,Meals,"[""high-protein"",""dinner""]",ACTIVE,,,,,,"[{""name"":""Size"",""position"":1,""values"":[""Regular"",""Large""]}]"

variants.csv:
id,product_handle,sku,title,option_values_json,price,compare_at_price,cost,barcode,inventory_policy,taxable,tax_code,position,weight_value,weight_unit
,grilled-salmon-bowl,SALMON-REG,Regular,"[{""name"":""Size"",""value"":""Regular""}]",12.99,,6.50,,DENY,true,,1,400,GRAMS
,grilled-salmon-bowl,SALMON-LG,Large,"[{""name"":""Size"",""value"":""Large""}]",15.99,,8.00,,DENY,true,,2,550,GRAMS

product_images.csv:
product_handle,position,src,alt,media_id,filename,file
grilled-salmon-bowl,1,https://example.com/img/salmon-bowl.jpg,Grilled Salmon Bowl,,,

inventory_levels.csv:
variant_id,inventory_item_id,product_handle,variant_sku,option_values,location_name,tracked,on_hand,available,committed,incoming,reserved,damaged,safety_stock,quality_control
,,grilled-salmon-bowl,SALMON-REG,"[{""name"":""Size"",""value"":""Regular""}]",Shop location,true,50,,,,,,,
,,grilled-salmon-bowl,SALMON-LG,"[{""name"":""Size"",""value"":""Large""}]",Shop location,true,30,,,,,,,

metafields.csv:
owner_type,owner_key,namespace,key,type,value
PRODUCT,grilled-salmon-bowl,custom,elevated_protein_pack_calories,single_line_text_field,540
PRODUCT,grilled-salmon-bowl,custom,elevated_protein_pack_protein,single_line_text_field,48g
PRODUCT,grilled-salmon-bowl,custom,meal_pack_url,url,https://meal-prep-4.myshopify.com/products/grilled-salmon-bowl
PRODUCT,grilled-salmon-bowl,custom,ingredients,rich_text_field,"{""type"":""root"",""children"":[{""type"":""paragraph"",""children"":[{""type"":""text"",""value"":""Wild-caught salmon, jasmine rice, broccoli.""}]}]}"

======================= MY PRODUCT DATA =======================
[PASTE YOUR PRODUCTS HERE — or attach your spreadsheet. Include for each product: title,
description, vendor, type, tags, any variant options (e.g. Size/Flavor) with each variant's
SKU, price, compare-at price, cost, weight, stock quantity, image URL(s), and any nutrition
metafields from the catalog above.]
```

---

## Prompt B — Collections

```text
You are a Shopify data-migration assistant. Convert the collections I describe at the bottom
into the two CSV files used by "Coalition Snapback". Output EXACT headers; show each file
inline and as a downloadable .csv. Output ONLY my new collections.

======================= FILE 6 — collections.csv =======================
Header (exact): id,handle,title,description_html,sort_order,template_suffix,seo_title,seo_description,image_src,image_alt,image_filename,image_file,collection_type,applied_disjunctively,rules_json,sources_json
- id: LEAVE BLANK (new collection).
- handle: unique, lowercase, hyphenated.
- sort_order: one of MANUAL | BEST_SELLING | ALPHA_ASC | ALPHA_DESC | PRICE_ASC | PRICE_DESC | CREATED | CREATED_DESC. Use MANUAL for a hand-ordered manual collection.
- template_suffix / seo_title / seo_description: blank unless I give them.
- image_src: a PUBLIC https image URL, or blank. Leave image_alt optional; leave image_filename and image_file BLANK.
- collection_type: "manual" or "smart".
- FOR A MANUAL COLLECTION:
    applied_disjunctively = blank, rules_json = blank, sources_json = []
    (list its products in FILE 7).
- FOR A SMART COLLECTION:
    applied_disjunctively = false  (products must match ALL rules) or true (match ANY rule)
    rules_json = a JSON array of rules; each rule is {"column":..,"relation":..,"condition":..}
    sources_json = [{"__typename":"CollectionConditionsSource"}]
    (do NOT list its products in FILE 7 — Shopify fills it from the rules).
  Smart-rule COLUMN values: TAG | TITLE | TYPE | VENDOR | VARIANT_PRICE | VARIANT_COMPARE_AT_PRICE | VARIANT_WEIGHT | VARIANT_INVENTORY | VARIANT_TITLE | IS_PRICE_REDUCED
  Smart-rule RELATION values: EQUALS | NOT_EQUALS | GREATER_THAN | LESS_THAN | STARTS_WITH | ENDS_WITH | CONTAINS | NOT_CONTAINS
  condition: the value to match (e.g. "Breakfast" for a tag, "10.0" for a price).

======================= FILE 7 — collection_products.csv =======================
Header (exact): collection_handle,product_handle
- ONE row per product in a MANUAL collection.
- collection_handle must match a handle in FILE 6; product_handle must match a product handle in products.csv.
- Leave this file empty for smart collections.

CSV ENCODING: any field with a comma, quote, or JSON must be wrapped in double quotes with
internal quotes doubled.

======================= WORKED EXAMPLES =======================
collections.csv:
id,handle,title,description_html,sort_order,template_suffix,seo_title,seo_description,image_src,image_alt,image_filename,image_file,collection_type,applied_disjunctively,rules_json,sources_json
,breakfast,Breakfast,<p>Morning meals.</p>,MANUAL,,Breakfast Meals,Start your day right,,,,,manual,,,[]
,under-10,Under $10,<p>Budget-friendly picks.</p>,BEST_SELLING,,,,,,,,smart,false,"[{""column"":""VARIANT_PRICE"",""relation"":""LESS_THAN"",""condition"":""10.0""}]","[{""__typename"":""CollectionConditionsSource""}]"
,high-protein,High Protein,<p>40g+ protein meals.</p>,MANUAL,,,,,,,,smart,false,"[{""column"":""TAG"",""relation"":""EQUALS"",""condition"":""high-protein""}]","[{""__typename"":""CollectionConditionsSource""}]"

collection_products.csv  (only the MANUAL collection "breakfast" gets rows):
collection_handle,product_handle
breakfast,protein-waffle-breakfast-bowl
breakfast,turkey-chorizo-breakfast-burrito
breakfast,potato-breakfast-bowl

======================= MY COLLECTIONS =======================
[DESCRIBE YOUR COLLECTIONS HERE. For each: name, manual or smart, and either the list of
product handles (manual) or the rule(s) (smart). Product handles must match products.csv.]
```

---

## After ChatGPT returns the files

1. **Append** the generated rows into the matching files in your backup folder (keep existing rows and headers).
2. **Re-zip at root** — select the files + `images/` *inside* the folder and compress the selection (not the parent folder).
3. **Restore** → upload the zip → tick the relevant resources (Products, Collections, Metafields, Inventory) → **dry-run** → confirm.
4. **Set product status** — new products default to `DRAFT` unless you set `status=ACTIVE`. Make them active in the sheet or in Shopify admin to show them on the storefront.

---

## Format cheat sheet

| Thing | Rule |
| --- | --- |
| **Join key** | `handle` — identical across every file |
| **New record** | leave `id` (and `variant_id`/`inventory_item_id`) **blank** |
| **tags** | JSON array: `["a","b"]` |
| **options_json** | `[{"name":"Size","position":1,"values":["S","L"]}]` |
| **option_values_json** | `[{"name":"Size","value":"S"}]` |
| **product status** | `ACTIVE` \| `DRAFT` \| `ARCHIVED` |
| **inventory_policy** | `DENY` \| `CONTINUE` |
| **weight_unit** | `GRAMS` \| `KILOGRAMS` \| `OUNCES` \| `POUNDS` |
| **taxable / tracked** | `true` \| `false` |
| **collection sort_order** | `MANUAL` \| `BEST_SELLING` \| `ALPHA_ASC` \| `ALPHA_DESC` \| `PRICE_ASC` \| `PRICE_DESC` \| `CREATED` \| `CREATED_DESC` |
| **collection_type** | `manual` \| `smart` |
| **metafield owner_key** | PRODUCT → handle · PRODUCTVARIANT → `handle::SKU` · COLLECTION → handle |
| **CSV escaping** | quote any field with a comma/quote/JSON; double internal quotes (`""`) |
| **on_hand** | a number; **blank = 0** |
| **images** | `src` = public https URL (Shopify fetches it) |

---

## Adapting the metafield catalog to another store

The catalog in Prompt A is specific to this store. To build one for any store:

1. Open that store's backup → `metafield_definitions.csv`.
2. For each row where `owner_type = PRODUCT`, copy `namespace`.`key` and its `type` into the CATALOG section.
3. Exclude **reference** types (`*_reference`) and **app/Shopify-managed** namespaces (`mm-google-shopping.*`, `reviews.*`, `shopify--*`, `app--*`) — set those in admin after restore.

---

<p align="center"><b>Proprietary — © 2026 Coalition Technologies. All rights reserved.</b></p>
