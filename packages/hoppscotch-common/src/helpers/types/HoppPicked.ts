/**
 * Picked is used to differentiate
 * the select item in the save request dialog
 * The save request dialog can be used
 * to save a request, folder, or a collection
 * separately for 'my' collections.
 * also for graphQL collections
 */
export type Picked =
  | {
      pickedType: "my-request"
      folderPath: string
      requestIndex: number
    }
  | {
      pickedType: "my-folder"
      folderPath: string
    }
  | {
      pickedType: "my-collection"
      collectionIndex: number
    }
  | {
      pickedType: "gql-my-request"
      folderPath: string
      requestIndex: number
    }
  | {
      pickedType: "gql-my-folder"
      folderPath: string
    }
  | {
      pickedType: "gql-my-collection"
      collectionIndex: number
    }
