import { BackendPlatformDef } from "~/platform/backend"

import { HoppGQLRequest, HoppRESTRequest } from "@hoppscotch/data"
import { runGQLQuery, runMutation } from "~/helpers/backend/GQLClient"

import {
  CreateShortcodeDocument,
  CreateShortcodeMutation,
  CreateShortcodeMutationVariables,
  GetUserShortcodesDocument,
  GetUserShortcodesQuery,
  GetUserShortcodesQueryVariables,
} from "../../helpers/backend/graphql"

import {
  createMockServer,
  updateMockServer,
  deleteMockServer,
} from "../../helpers/backend/mutations/MockServer"
import {
  getMockServer,
  getMyMockServers,
} from "../../helpers/backend/queries/MockServer"
import {
  getMockServerLogs,
  deleteMockServerLog,
} from "../../helpers/backend/queries/MockServerLogs"
import {
  createPublishedDoc,
  updatePublishedDoc,
  deletePublishedDoc,
} from "../../helpers/backend/mutations/PublishedDocs"
import {
  getPublishedDocByID,
  getUserPublishedDocs,
} from "../../helpers/backend/queries/PublishedDocs"

const getUserShortcodes = (cursor?: string) => {
  return runGQLQuery<
    GetUserShortcodesQuery,
    GetUserShortcodesQueryVariables,
    ""
  >({
    query: GetUserShortcodesDocument,
    variables: {
      cursor,
    },
  })
}

export const createShortcode = (
  request: HoppRESTRequest | HoppGQLRequest,
  properties?: string
) => {
  return runMutation<
    CreateShortcodeMutation,
    CreateShortcodeMutationVariables,
    ""
  >(CreateShortcodeDocument, {
    request: JSON.stringify(request),
    properties,
  })
}

export const def: BackendPlatformDef = {
  getUserShortcodes,
  createShortcode,
  createMockServer,
  updateMockServer,
  deleteMockServer,
  getMockServer,
  getMyMockServers,
  getMockServerLogs,
  deleteMockServerLog,
  createPublishedDoc,
  updatePublishedDoc,
  deletePublishedDoc,
  getPublishedDocByID,
  getUserPublishedDocs,
}
