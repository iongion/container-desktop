// Containerfile / Compose generator. Pick a template, edit it in Monaco, then use
// the shared <AIComposer> (same interaction as the Assistant) to stream a fresh/improved file into the
// editor (window.AI.generate → AIBus by streamId). Gated by Metadata.RequiresAI. Save uses file-saver.
import { Button, ButtonGroup, HTMLSelect } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AI_CHANNELS, type ChatStreamEvent } from "@/ai-system/core";
import { AIComposer } from "@/web-app/components/AIComposer";
import { CodeEditor } from "@/web-app/components/CodeEditor";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import "./GeneratorScreen.css";

export const ID = "ai.generator";
export const Title = "Generator";

// Static starting points (no AI required). The AI step refines/replaces the editor content.
const DOCKERFILE_TEMPLATES: Record<string, string> = {
  Node: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "index.js"]\n',
  Python:
    'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["python", "main.py"]\n',
  Go: 'FROM golang:1.25 AS build\nWORKDIR /src\nCOPY go.* ./\nRUN go mod download\nCOPY . .\nRUN CGO_ENABLED=0 go build -o /app ./...\n\nFROM gcr.io/distroless/static\nCOPY --from=build /app /app\nENTRYPOINT ["/app"]\n',
  Rust: 'FROM rust:1 AS build\nWORKDIR /src\nCOPY . .\nRUN cargo build --release\n\nFROM debian:stable-slim\nCOPY --from=build /src/target/release/app /usr/local/bin/app\nCMD ["app"]\n',
  Java: 'FROM eclipse-temurin:21-jdk AS build\nWORKDIR /src\nCOPY . .\nRUN ./mvnw -q package -DskipTests\n\nFROM eclipse-temurin:21-jre\nCOPY --from=build /src/target/*.jar /app.jar\nENTRYPOINT ["java", "-jar", "/app.jar"]\n',
  Ruby: 'FROM ruby:3.3-slim\nWORKDIR /app\nCOPY Gemfile* ./\nRUN bundle install\nCOPY . .\nCMD ["ruby", "app.rb"]\n',
  ".NET":
    'FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build\nWORKDIR /src\nCOPY . .\nRUN dotnet publish -c Release -o /app\n\nFROM mcr.microsoft.com/dotnet/aspnet:8.0\nCOPY --from=build /app /app\nENTRYPOINT ["dotnet", "/app/app.dll"]\n',
};
const COMPOSE_TEMPLATE =
  'services:\n  app:\n    build: .\n    ports:\n      - "8080:8080"\n    environment:\n      - NODE_ENV=production\n    restart: unless-stopped\n';
const LANGS = Object.keys(DOCKERFILE_TEMPLATES);

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();

  const [kind, setKind] = useState<"containerfile" | "compose">("containerfile");
  const [lang, setLang] = useState(LANGS[0]);
  const [value, setValue] = useState(DOCKERFILE_TEMPLATES[LANGS[0]]);
  const [generating, setGenerating] = useState(false);
  const streamIdRef = useRef<string | null>(null);

  // Stream generate output into the editor; ignore events for other streams (multiplexing).
  useEffect(() => {
    if (typeof window === "undefined" || !window.AIBus) {
      return;
    }
    return window.AIBus.subscribe(AI_CHANNELS.streamEvent, (evt: ChatStreamEvent) => {
      if (evt.streamId !== streamIdRef.current) {
        return;
      }
      if (evt.type === "delta") {
        setValue((v) => v + (evt.payload.text ?? ""));
      } else {
        setGenerating(false);
        streamIdRef.current = null;
      }
    });
  }, []);

  const loadTemplate = (nextKind: "containerfile" | "compose", nextLang: string) => {
    setKind(nextKind);
    setLang(nextLang);
    setValue(nextKind === "compose" ? COMPOSE_TEMPLATE : DOCKERFILE_TEMPLATES[nextLang]);
  };

  const onGenerate = async (instruction: string, providerId: string) => {
    const template = value;
    setValue("");
    setGenerating(true);
    try {
      const { streamId } = await window.AI.generate({ kind, template, instruction, providerId });
      streamIdRef.current = streamId;
    } catch {
      setGenerating(false);
      setValue(template);
    }
  };

  const onSave = () => {
    const name = kind === "compose" ? "compose.yaml" : "Containerfile";
    saveAs(new Blob([value], { type: "text/plain;charset=utf-8" }), name);
  };

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="GeneratorHeader">
        <ButtonGroup>
          <Button
            active={kind === "containerfile"}
            text={t("Containerfile")}
            onClick={() => loadTemplate("containerfile", lang)}
          />
          <Button active={kind === "compose"} text={t("Compose")} onClick={() => loadTemplate("compose", lang)} />
        </ButtonGroup>
        {kind === "containerfile" ? (
          <HTMLSelect value={lang} onChange={(e) => loadTemplate("containerfile", e.currentTarget.value)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </HTMLSelect>
        ) : null}
        <Button icon={IconNames.DOWNLOAD} text={t("Save")} onClick={onSave} />
      </div>

      <div className="GeneratorEditor">
        <CodeEditor
          value={value}
          mode={kind === "compose" ? "yaml" : "containerfile"}
          readOnly={false}
          onChange={setValue}
        />
      </div>

      <AIComposer
        placeholder={t("Describe the file to generate or improve…")}
        streaming={generating}
        onSubmit={(instruction, { providerId }) => void onGenerate(instruction, providerId)}
      />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/screens/ai/generator",
};
Screen.Metadata = {
  LeftIcon: IconNames.DOCUMENT,
  RequiresAI: true,
  ExcludeFromSidebar: true, // reached via the header AI menu, not the sidebar
};
