import {
  //   loginIcon,
  //   ExcalLogo,
  //   eyeIcon,
  WorkspaceIcon,
} from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { useAuth } from "./Auth";

// import { LanguageList } from "../app-language/LanguageList";
// import { isExcalidrawPlusSignedUser } from "../app_constants";

// import { saveDebugState } from "./DebugCanvas";

// Sign out icon
const SignOutIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
  refresh: () => void;
  onNavigateToDashboard?: () => void;
}> = React.memo((props) => {
  const { signOut, user } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />

      {props.onNavigateToDashboard && (
        <MainMenu.Item
          icon={WorkspaceIcon}
          onSelect={props.onNavigateToDashboard}
        >
          Workspace
        </MainMenu.Item>
      )}

      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={props.theme}
        onSelect={props.setTheme}
      />

      <MainMenu.DefaultItems.ChangeCanvasBackground />

      {user && (
        <>
          <MainMenu.Separator />
          <MainMenu.Item
            icon={SignOutIcon}
            onSelect={handleSignOut}
          >
            Sign Out
          </MainMenu.Item>
        </>
      )}
    </MainMenu>
  );
});
