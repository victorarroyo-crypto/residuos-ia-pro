"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen, Loader2 } from "lucide-react";

const PICKER_API_URL = "https://apis.google.com/js/api.js";

interface GoogleDrivePickerProps {
  consultantId: string;
  disabled?: boolean;
  onFolderSelected: (folderId: string, folderName: string) => void;
  onError: (error: string) => void;
}

declare global {
  interface Window {
    gapi: {
      load: (api: string, callback: () => void) => void;
      client: { getToken: () => { access_token: string } | null };
    };
    google: {
      picker: {
        PickerBuilder: new () => PickerBuilder;
        ViewId: { FOLDERS: string };
        DocsView: new (viewId: string) => DocsView;
        Action: { PICKED: string; CANCEL: string };
        Feature: { MINE_ONLY: string };
      };
    };
  }

  interface PickerBuilder {
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    addView(view: DocsView): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    enableFeature(feature: string): PickerBuilder;
    setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
    build(): { setVisible(visible: boolean): void };
  }

  interface DocsView {
    setSelectFolderEnabled(enabled: boolean): DocsView;
    setIncludeFolders(include: boolean): DocsView;
    setMimeTypes(mimeTypes: string): DocsView;
  }

  interface PickerResponse {
    action: string;
    docs?: Array<{
      id: string;
      name: string;
      mimeType: string;
    }>;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadPickerApi(): Promise<void> {
  return new Promise((resolve) => {
    window.gapi.load("picker", resolve);
  });
}

export function GoogleDrivePicker({
  consultantId,
  disabled,
  onFolderSelected,
  onError,
}: GoogleDrivePickerProps) {
  const [loading, setLoading] = useState(false);
  const pickerApiLoaded = useRef(false);

  const openPicker = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get fresh access token and client_id from backend
      const tokenRes = await fetch(
        `/api/gdrive/picker-token?consultant_id=${consultantId}`
      );
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        onError(err.error || "No se pudo obtener token para el Picker.");
        setLoading(false);
        return;
      }
      const { access_token, client_id } = await tokenRes.json();

      // 2. Load Google Picker API script if not already loaded
      await loadScript(PICKER_API_URL);
      if (!pickerApiLoaded.current) {
        await loadPickerApi();
        pickerApiLoaded.current = true;
      }

      // 3. Extract project number from client_id for setAppId
      // client_id format: "123456789.apps.googleusercontent.com"
      const appId = client_id?.split("-")[0]?.split(".")[0] || "";

      // 4. Build and show the Picker
      const view = new window.google.picker.DocsView(
        window.google.picker.ViewId.FOLDERS
      )
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes("application/vnd.google-apps.folder");

      const picker = new window.google.picker.PickerBuilder()
        .setOAuthToken(access_token)
        .setAppId(appId)
        .addView(view)
        .setTitle("Selecciona la carpeta raiz para la estructura de residuos")
        .enableFeature(window.google.picker.Feature.MINE_ONLY)
        .setCallback((data: PickerResponse) => {
          if (data.action === window.google.picker.Action.PICKED && data.docs?.[0]) {
            const folder = data.docs[0];
            onFolderSelected(folder.id, folder.name);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      onError(`Error al abrir el selector: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }, [consultantId, onFolderSelected, onError]);

  return (
    <Button
      onClick={openPicker}
      disabled={disabled || loading}
      variant="outline"
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <FolderOpen className="mr-2 h-4 w-4" />
      )}
      {loading ? "Abriendo selector..." : "Seleccionar carpeta en Drive"}
    </Button>
  );
}
