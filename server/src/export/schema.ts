// Column definitions shared by the exporter (writer) and the importer (loader),
// so the CSV set round-trips losslessly.

export const FILES = {
  products: 'products.csv',
  variants: 'variants.csv',
  images: 'product_images.csv',
  collections: 'collections.csv',
  collectionProducts: 'collection_products.csv',
  metafields: 'metafields.csv',
  metafieldDefinitions: 'metafield_definitions.csv',
  metaobjectDefinitions: 'metaobject_definitions.csv',
  metaobjects: 'metaobjects.csv',
  locations: 'locations.csv',
  inventoryLevels: 'inventory_levels.csv',
  themes: 'themes.csv',
  themeFiles: 'theme_files.csv',
  productsNative: 'products_native.csv',
  manifest: 'manifest.json',
} as const;

export const COLS = {
  products: [
    'id', 'handle', 'title', 'description_html', 'vendor', 'product_type', 'tags', 'status',
    'template_suffix', 'category_id', 'category_name', 'seo_title', 'seo_description', 'options_json',
  ],
  variants: [
    'id', 'product_handle', 'sku', 'title', 'option_values_json', 'price', 'compare_at_price', 'cost',
    'barcode', 'inventory_policy', 'taxable', 'tax_code', 'position', 'weight_value', 'weight_unit',
  ],
  images: ['product_handle', 'position', 'src', 'alt', 'media_id', 'filename', 'file'],
  collections: [
    'id', 'handle', 'title', 'description_html', 'sort_order', 'template_suffix',
    'seo_title', 'seo_description', 'image_src', 'image_alt', 'image_filename', 'image_file',
    'collection_type', 'applied_disjunctively', 'rules_json', 'sources_json',
  ],
  collectionProducts: ['collection_handle', 'product_handle'],
  metafields: ['owner_type', 'owner_key', 'namespace', 'key', 'type', 'value'],
  metafieldDefinitions: [
    'owner_type', 'namespace', 'key', 'name', 'description', 'type', 'pinned_position',
    'validations_json', 'access_json',
  ],
  metaobjectDefinitions: ['id', 'type', 'name', 'display_name_key', 'field_definitions_json', 'capabilities_json', 'access_json'],
  metaobjects: ['id', 'type', 'handle', 'display_name', 'fields_json'],
  locations: ['name', 'is_active', 'legacy_id', 'address_json'],
  inventoryLevels: [
    'variant_id', 'inventory_item_id', 'product_handle', 'variant_sku', 'option_values', 'location_name', 'tracked',
    'on_hand', 'available', 'committed', 'incoming', 'reserved', 'damaged', 'safety_stock', 'quality_control',
  ],
  themes: ['name', 'role', 'theme_store_id', 'zip_file'],
  themeFiles: ['theme_name', 'filename', 'content_type', 'size', 'checksum'],
  productsNative: [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
    'Variant SKU', 'Variant Price', 'Variant Compare At Price', 'Variant Barcode',
    'Image Src', 'Image Position', 'Status',
  ],
} as const;

/** MetafieldOwnerType values we back up definitions for (products/collections scope). */
export const DEFINITION_OWNER_TYPES = ['PRODUCT', 'PRODUCTVARIANT', 'COLLECTION'] as const;

export const SCHEMA_VERSION = 2;

/** A metafield type that stores one or more Shopify GIDs and needs remapping on cross-store restore. */
export function isReferenceType(type: string): boolean {
  return type.includes('_reference');
}
