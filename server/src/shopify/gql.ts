/**
 * GraphQL query/mutation library for the Admin API (2026-07).
 *
 * NOTE ON BULK LIMITS: a bulk query allows max 2 nesting levels, max 5 connections,
 * one root connection. So variant metafields go in a SEPARATE bulk op (rooted at
 * productVariants), and collections are their own bulk op.
 */

// Only non-protected fields — 'email' is protected customer data and 403s without approval.
export const SHOP_QUERY = /* GraphQL */ `
  query Shop { shop { name myshopifyDomain currencyCode } }
`;

// ---- Bulk query bodies (inner query passed to bulkOperationRunQuery) ----

export const BULK_PRODUCTS = /* GraphQL */ `
{
  products {
    edges { node {
      id handle title descriptionHtml vendor productType tags status
      templateSuffix
      category { id fullName }
      seo { title description }
      options { name position optionValues { name } }
      variants {
        edges { node {
          id title sku barcode price compareAtPrice
          inventoryPolicy taxable taxCode position
          selectedOptions { name value }
          inventoryItem { measurement { weight { value unit } } cost: unitCost { amount currencyCode } }
        } }
      }
      media {
        edges { node {
          ... on MediaImage { id alt image { url } }
        } }
      }
      metafields {
        edges { node { id namespace key type value } }
      }
    } }
  }
}`;

export const BULK_VARIANT_METAFIELDS = /* GraphQL */ `
{
  productVariants {
    edges { node {
      id sku
      product { id handle }
      metafields {
        edges { node { id namespace key type value } }
      }
    } }
  }
}`;

export const BULK_COLLECTIONS = /* GraphQL */ `
{
  collections {
    edges { node {
      id handle title descriptionHtml sortOrder templateSuffix
      seo { title description }
      image { url altText }
      sources { __typename }
      ruleSet { appliedDisjunctively rules { column relation condition } }
      products { edges { node { id handle } } }
      metafields { edges { node { id namespace key type value } } }
    } }
  }
}`;

// ---- Paginated queries (definitions + metaobjects) ----

export const METAFIELD_DEFINITIONS = /* GraphQL */ `
  query Defs($ownerType: MetafieldOwnerType!, $after: String) {
    metafieldDefinitions(first: 100, ownerType: $ownerType, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id name namespace key description type { name } ownerType pinnedPosition
        validations { name value }
        access { admin storefront customerAccount }
      } }
    }
  }
`;

export const METAOBJECT_DEFINITIONS = /* GraphQL */ `
  query MoDefs($after: String) {
    metaobjectDefinitions(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id type name displayNameKey
        fieldDefinitions { key name type { name } required validations { name value } }
        access { storefront }
        capabilities { publishable { enabled } translatable { enabled } }
      } }
    }
  }
`;

export const METAOBJECTS_BY_TYPE = /* GraphQL */ `
  query Metaobjects($type: String!, $after: String) {
    metaobjects(type: $type, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id handle type displayName
        fields { key value type }
      } }
    }
  }
`;

// ---- Themes (backup only) ----

export const THEMES = /* GraphQL */ `
  query Themes { themes(first: 50) { nodes { id name role themeStoreId } } }
`;

export const THEME_FILES = /* GraphQL */ `
  query ThemeFiles($id: ID!, $cursor: String) {
    theme(id: $id) {
      id name role
      files(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          filename contentType size checksumMd5
          body {
            __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
      }
    }
  }
`;

// ---- Locations & inventory ----

export const LOCATIONS = /* GraphQL */ `
  query Locations($after: String) {
    locations(first: 250, after: $after, includeInactive: true) {
      pageInfo { hasNextPage endCursor }
      edges { node { id name isActive legacyResourceId address { address1 address2 city province country zip } } }
    }
  }
`;

// Bulk pass rooted at inventoryItems so inventoryLevels flatten cleanly under a single root id.
export const BULK_INVENTORY = /* GraphQL */ `
{
  inventoryItems {
    edges { node {
      id tracked
      variant { id sku selectedOptions { name value } product { handle } }
      inventoryLevels {
        edges { node {
          id
          location { id name }
          quantities(names: ["on_hand","available","committed","incoming","reserved","damaged","safety_stock","quality_control"]) { name quantity }
        } }
      }
    } }
  }
}`;

// ---- Bulk operation control ----

export const BULK_RUN_QUERY = /* GraphQL */ `
  mutation Run($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

export const CURRENT_BULK_OPERATION = /* GraphQL */ `
  query CurrentBulk {
    currentBulkOperation(type: QUERY) {
      id status errorCode objectCount rootObjectCount url partialDataUrl fileSize
    }
  }
`;

// ---- Restore mutations ----

export const PRODUCT_SET = /* GraphQL */ `
  mutation ProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id handle variants(first: 250) { nodes { id sku } } }
      userErrors { field message }
    }
  }
`;

export const VARIANT_INVENTORY_ITEM = /* GraphQL */ `
  query VarInvItem($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }
`;

const INV_LEVELS_FRAGMENT = `inventoryItem {
  id
  inventoryLevels(first: 100) {
    nodes { location { name } quantities(names: ["on_hand"]) { name quantity } }
  }
}`;

export const PRODUCT_VARIANT_BY_SKU = /* GraphQL */ `
  query VarBySku($q: String!) {
    productVariants(first: 1, query: $q) { nodes { id ${INV_LEVELS_FRAGMENT} } }
  }
`;

// Same-store resolution: the original inventory item GID is still valid.
export const INVENTORY_ITEM_LEVELS = /* GraphQL */ `
  query InvItemLevels($id: ID!) {
    inventoryItem(id: $id) {
      id
      inventoryLevels(first: 100) {
        nodes { location { name } quantities(names: ["on_hand"]) { name quantity } }
      }
    }
  }
`;

// No-SKU resolution: match a variant within a product by its option values.
export const PRODUCT_VARIANTS_BY_HANDLE = /* GraphQL */ `
  query VarsByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      variants(first: 250) {
        nodes { id selectedOptions { name value } ${INV_LEVELS_FRAGMENT} }
      }
    }
  }
`;

export const INVENTORY_ITEM_UPDATE = /* GraphQL */ `
  mutation InvItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id }
      userErrors { field message }
    }
  }
`;

export const INVENTORY_ACTIVATE = /* GraphQL */ `
  mutation InvActivate($inventoryItemId: ID!, $locationId: ID!, $key: String!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $key) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

export const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation InvSet($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      inventoryAdjustmentGroup { id }
      userErrors { field message code }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE = /* GraphQL */ `
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE = /* GraphQL */ `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }
`;

export const METAOBJECT_DEFINITION_BY_TYPE = /* GraphQL */ `
  query MoDefByType($type: String!) { metaobjectDefinitionByType(type: $type) { id } }
`;

export const METAOBJECT_UPSERT = /* GraphQL */ `
  mutation MetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle type }
      userErrors { field message code }
    }
  }
`;

export const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

export const METAFIELDS_SET = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_CREATE = /* GraphQL */ `
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id handle }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_UPDATE = /* GraphQL */ `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id handle }
      userErrors { field message }
    }
  }
`;

export const COLLECTION_BY_HANDLE = /* GraphQL */ `
  query CollectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) { id handle }
  }
`;

// Membership can't be set via collectionUpdate's input.products — add it separately.
export const COLLECTION_ADD_PRODUCTS = /* GraphQL */ `
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id }
      userErrors { field message }
    }
  }
`;

export const PRODUCT_BY_HANDLE = /* GraphQL */ `
  query ProductByHandle($handle: String!) {
    productByHandle(handle: $handle) { id handle }
  }
`;
