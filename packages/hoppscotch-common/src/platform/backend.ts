import { HoppGQLRequest, HoppRESTRequest } from "@hoppscotch/data"
import * as TE from "fp-ts/TaskEither"
import * as E from "fp-ts/lib/Either"

import { GQLError } from "~/helpers/backend/GQLClient"
import {
  CreatePublishedDocMutation,
  CreatePublishedDocsArgs,
  CreateShortcodeMutation,
  DeletePublishedDocMutation,
  GetMockServerLogsQuery,
  GetUserShortcodesQuery,
  PublishedDocQuery,
  UpdatePublishedDocMutation,
  UpdatePublishedDocsArgs,
  UserPublishedDocsListQuery,
  WorkspaceType,
} from "~/helpers/backend/graphql"

import type { MockServer } from "~/helpers/backend/types/MockServer"

export type BackendPlatformDef = {
  // Read actions via GQL queries
  getUserShortcodes: (
    cursor?: string
  ) => Promise<E.Either<GQLError<"">, GetUserShortcodesQuery>>

  // Write actions via GQL mutations
  createShortcode: (
    request: HoppRESTRequest | HoppGQLRequest,
    properties?: string
  ) => TE.TaskEither<GQLError<string>, CreateShortcodeMutation>

  // Mock server operations
  createMockServer: (
    name: string,
    workspaceType?: WorkspaceType,
    workspaceID?: string,
    delayInMs?: number,
    isPublic?: boolean,
    collectionID?: string,
    autoCreateCollection?: boolean,
    autoCreateRequestExample?: boolean
  ) => TE.TaskEither<string, MockServer>

  updateMockServer: (
    id: string,
    input: {
      name?: string
      isActive?: boolean
      delayInMs?: number
      isPublic?: boolean
    }
  ) => TE.TaskEither<string, MockServer>

  deleteMockServer: (id: string) => TE.TaskEither<string, boolean>

  getMockServer: (id: string) => TE.TaskEither<string, MockServer>

  getMyMockServers: (
    skip?: number,
    take?: number
  ) => TE.TaskEither<string, MockServer[]>

  getMockServerLogs: (
    mockServerID: string,
    skip?: number,
    take?: number
  ) => TE.TaskEither<string, GetMockServerLogsQuery["mockServerLogs"]>

  deleteMockServerLog: (logID: string) => TE.TaskEither<string, boolean>

  // Published docs operations
  createPublishedDoc: (
    doc: CreatePublishedDocsArgs
  ) => TE.TaskEither<GQLError<string>, CreatePublishedDocMutation>

  updatePublishedDoc: (
    id: string,
    doc: UpdatePublishedDocsArgs
  ) => TE.TaskEither<GQLError<string>, UpdatePublishedDocMutation>

  deletePublishedDoc: (
    id: string
  ) => TE.TaskEither<GQLError<string>, DeletePublishedDocMutation>

  getPublishedDocByID: (
    id: string
  ) => TE.TaskEither<string, PublishedDocQuery["publishedDoc"]>

  getUserPublishedDocs: (
    skip?: number,
    take?: number
  ) => TE.TaskEither<
    string,
    UserPublishedDocsListQuery["userPublishedDocsList"]
  >
}
