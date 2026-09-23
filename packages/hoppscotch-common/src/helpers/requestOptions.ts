const _VALID_OPTION_TABS = [
  "params",
  "bodyParams",
  "headers",
  "authorization",
  "preRequestScript",
  "tests",
  "requestVariables",
] as const

export type RESTOptionTabs = (typeof _VALID_OPTION_TABS)[number]

const _VALID_GQL_OPERATIONS = [
  "query",
  "headers",
  "variables",
  "authorization",
  "preRequestScript",
  "tests",
] as const

export type GQLOptionTabs = (typeof _VALID_GQL_OPERATIONS)[number]
