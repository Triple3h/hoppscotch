import { Service } from "dioc"
import { ref, readonly } from "vue"
import { WorkspaceTabsService } from "./tab/workspace-tabs"

/**
 * Defines a workspace and its information.
 *
 * The app is personal-workspace-only: there are no team workspaces, so the
 * workspace type is a fixed `{ type: "personal" }` value.
 */

export type PersonalWorkspace = {
  type: "personal"
}

export type Workspace = PersonalWorkspace

export type WorkspaceServiceEvent = {
  type: "managed-team-list-adapter-polled"
}

/**
 * This services manages workspace related data and actions in Hoppscotch.
 */
export class WorkspaceService extends Service<WorkspaceServiceEvent> {
  public static readonly ID = "WORKSPACE_SERVICE"

  private _currentWorkspace = ref<Workspace>({ type: "personal" })

  /**
   * A readonly reference to the currently selected workspace
   */
  public currentWorkspace = readonly(this._currentWorkspace)

  private workspaceTabsService = this.bind(WorkspaceTabsService)

  override onServiceInit() {
    this.setupWorkspaceSync()
  }

  /**
   * Keeps the unified tab service attached to the (personal) workspace.
   */
  private setupWorkspaceSync() {
    this.workspaceTabsService.attachToWorkspace({ type: "personal" })
  }

  /**
   * Changes the current workspace. Only the personal workspace exists, so this
   * is a no-op that resets to personal.
   */
  public changeWorkspace(_workspace: Workspace) {
    this._currentWorkspace.value = { type: "personal" }
  }
}
