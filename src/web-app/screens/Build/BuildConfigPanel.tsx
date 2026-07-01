import { Button, Collapse, Divider, FormGroup, InputGroup, Switch, TagInput, TextArea } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { FEATURE_MATRIX } from "@/container-client/build/featureMatrix";
import type { BuildEngineKind, BuildSecret, ImageBuildOptions, NamedContext } from "@/container-client/build/types";
import { Environments } from "@/env/Types";
import { CURRENT_ENVIRONMENT } from "@/web-app/Environment";

import { buildRedactedPreview, canLoadLocally } from "./BuildConfigPanel.logic";

export interface BuildConfigPanelProps {
  engine: BuildEngineKind;
  connectionId: string;
  containerfileContent: string;
  onOptionsChange: (options: ImageBuildOptions) => void;
}

// The editable subset the panel owns (the rest of ImageBuildOptions comes from props / the editor). Build
// args and labels are plain text (KEY=value tokens) — simpler than row editors and quick to paste.
interface FormState {
  containerfilePath: string;
  contextDir: string;
  tags: string[];
  buildArgsText: string;
  labelsText: string;
  target: string;
  platforms: string[];
  secrets: BuildSecret[];
  sshMounts: string[];
  namedContexts: NamedContext[];
  cacheFrom: string[];
  noCache: boolean;
  pull: boolean;
  push: boolean;
}

// In development we ship a tiny, ready-to-build sample context under support/image-builders (package.json +
// package-lock.json + server.js) so a real image build can be exercised with a single click. Production starts
// from the conventional Containerfile + "." and expects the user to point the pickers at their own project.
const DEV_SAMPLE = CURRENT_ENVIRONMENT === Environments.DEVELOPMENT;

const INITIAL: FormState = {
  containerfilePath: DEV_SAMPLE ? "./support/image-builders/Containerfile" : "Containerfile",
  contextDir: DEV_SAMPLE ? "./support/image-builders" : ".",
  tags: ["app:latest"],
  buildArgsText: "",
  labelsText: "",
  target: "",
  platforms: [],
  secrets: [],
  sshMounts: [],
  namedContexts: [],
  cacheFrom: [],
  noCache: false,
  pull: false,
  push: false,
};

// Parse a free-text list of KEY=value tokens. Accepts comma-, whitespace- and newline-separated input, so
// "VER=9, DEBUG=true" and "VER=9 DEBUG=true" both work.
function parseKeyValueText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of text.split(/[\s,]+/)) {
    const trimmed = token.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return out;
}

export const BuildConfigPanel: React.FC<BuildConfigPanelProps> = ({
  engine,
  connectionId,
  containerfileContent,
  onOptionsChange,
}) => {
  const { t } = useTranslation();
  const features = FEATURE_MATRIX[engine];
  const [form, setForm] = useState<FormState>(INITIAL);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }));

  // Native file/dir pickers. When the picked context equals the Containerfile's own directory we collapse it
  // to "." — the common case, and what the engine expects for "build from here".
  const browseContainerfile = async () => {
    const result = await Application.getInstance().openFileSelector({});
    const filePath = result?.filePaths?.[0];
    if (result?.canceled || !filePath) {
      return;
    }
    const dir = await Path.dirname(filePath).catch(() => "");
    const contextDir = !form.contextDir || form.contextDir === "." || form.contextDir === dir ? "." : form.contextDir;
    patch({ containerfilePath: filePath, contextDir });
  };

  const browseContext = async () => {
    const result = await Application.getInstance().openFileSelector({ directory: true });
    const dirPath = result?.filePaths?.[0];
    if (result?.canceled || !dirPath) {
      return;
    }
    const cfDir = form.containerfilePath ? await Path.dirname(form.containerfilePath).catch(() => "") : "";
    patch({ contextDir: cfDir && dirPath === cfDir ? "." : dirPath });
  };

  // Compose the effective ImageBuildOptions from props + form and publish upward for the header Build button
  // and the command preview.
  const options: ImageBuildOptions = useMemo(
    () => ({
      engine,
      connectionId,
      containerfilePath: form.containerfilePath,
      contextDir: form.contextDir,
      containerfileContent,
      tags: form.tags,
      buildArgs: parseKeyValueText(form.buildArgsText),
      labels: features.label ? parseKeyValueText(form.labelsText) : {},
      target: form.target || undefined,
      platforms: form.platforms,
      noCache: form.noCache,
      pull: form.pull,
      push: form.push,
      secrets: features.secrets ? form.secrets.filter((secret) => secret.id.trim()) : [],
      sshMounts: features.ssh ? form.sshMounts.filter(Boolean).map((id) => ({ id })) : [],
      namedContexts: features.namedContexts ? form.namedContexts.filter((context) => context.name.trim()) : [],
      cacheFrom: features.cache ? form.cacheFrom.filter(Boolean) : [],
      cacheTo: [],
    }),
    [engine, connectionId, containerfileContent, form, features],
  );

  useEffect(() => {
    onOptionsChange(options);
  }, [options, onOptionsChange]);

  const preview = buildRedactedPreview(options);
  const multiPlatform = form.platforms.length > 1;

  const onCopy = () => {
    navigator.clipboard?.writeText(preview).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  return (
    <aside className="panel config-panel" data-region="config">
      <header>
        <span>{t("Build configuration")}</span>
      </header>
      <div className="body">
        <FormGroup className="field" label={t("Image tags")}>
          <TagInput
            values={form.tags}
            onChange={(values) => patch({ tags: values.map((value) => `${value}`) })}
            placeholder={t("name:tag, add more…")}
            addOnBlur
          />
        </FormGroup>

        <div className="row">
          <FormGroup className="field" label={t("Containerfile")}>
            <InputGroup
              value={form.containerfilePath}
              onChange={(event) => patch({ containerfilePath: event.target.value })}
              rightElement={
                <Button
                  variant="minimal"
                  icon={IconNames.DOCUMENT_OPEN}
                  title={t("Choose a Containerfile")}
                  onClick={browseContainerfile}
                />
              }
            />
          </FormGroup>
          <FormGroup className="field" label={t("Context")}>
            <InputGroup
              value={form.contextDir}
              onChange={(event) => patch({ contextDir: event.target.value })}
              rightElement={
                <Button
                  variant="minimal"
                  icon={IconNames.FOLDER_OPEN}
                  title={t("Choose the build context directory")}
                  onClick={browseContext}
                />
              }
            />
          </FormGroup>
        </div>

        <FormGroup
          className="field"
          label={t("Build arguments")}
          helperText={t("KEY=value, space, comma or newline separated")}
        >
          <TextArea
            fill
            autoResize
            value={form.buildArgsText}
            placeholder={"VER=9\nDEBUG=true"}
            onChange={(event) => patch({ buildArgsText: event.target.value })}
          />
        </FormGroup>

        <div className="row">
          <FormGroup className="field" label={t("Target stage")}>
            <InputGroup
              value={form.target}
              placeholder={t("(final)")}
              onChange={(event) => patch({ target: event.target.value })}
            />
          </FormGroup>
          <FormGroup className="field" label={t("Platforms")}>
            <TagInput
              values={form.platforms}
              onChange={(values) => patch({ platforms: values.map((value) => `${value}`) })}
              placeholder={t("linux/amd64…")}
              disabled={!features.multiPlatform && form.platforms.length >= 1}
              addOnBlur
            />
          </FormGroup>
        </div>

        {multiPlatform && !canLoadLocally(options) ? (
          <div className="cfg-note">
            {t("Multi-platform images can't be loaded into the local store — enable push or an export output.")}
          </div>
        ) : null}

        <Button
          className="field"
          variant="minimal"
          alignText="left"
          fill
          icon={advancedOpen ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT}
          text={t("Advanced · BuildKit")}
          onClick={() => setAdvancedOpen((open) => !open)}
        />
        <Collapse isOpen={advancedOpen}>
          {features.label ? (
            <FormGroup
              className="field"
              label={t("Labels")}
              helperText={t("KEY=value, space, comma or newline separated")}
            >
              <TextArea
                fill
                autoResize
                value={form.labelsText}
                placeholder={"org.opencontainers.image.source=…\nteam=platform"}
                onChange={(event) => patch({ labelsText: event.target.value })}
              />
            </FormGroup>
          ) : null}

          {features.secrets ? (
            <FormGroup className="field" label={t("Secrets")}>
              <SecretRows rows={form.secrets} onChange={(secrets) => patch({ secrets })} />
            </FormGroup>
          ) : null}

          {features.ssh ? (
            <FormGroup className="field" label={t("SSH mounts")}>
              <StringRows
                rows={form.sshMounts}
                onChange={(sshMounts) => patch({ sshMounts })}
                placeholder="default"
                addLabel={t("Add ssh mount")}
              />
            </FormGroup>
          ) : null}

          {features.namedContexts ? (
            <FormGroup className="field" label={t("Named build contexts")}>
              <NamedContextRows rows={form.namedContexts} onChange={(namedContexts) => patch({ namedContexts })} />
            </FormGroup>
          ) : null}

          {features.cache ? (
            <FormGroup className="field" label={t("Cache from")}>
              <StringRows
                rows={form.cacheFrom}
                onChange={(cacheFrom) => patch({ cacheFrom })}
                placeholder="type=registry,ref=…"
                addLabel={t("Add cache source")}
              />
            </FormGroup>
          ) : null}

          <Switch
            checked={form.noCache}
            label={t("No cache")}
            onChange={(event) => patch({ noCache: event.currentTarget.checked })}
          />
          <Switch
            checked={form.pull}
            label={t("Always pull base")}
            onChange={(event) => patch({ pull: event.currentTarget.checked })}
          />
          <Switch
            checked={form.push}
            label={t("Push after build")}
            onChange={(event) => patch({ push: event.currentTarget.checked })}
          />
        </Collapse>

        <div className="cmd">
          <div className="cmd-head">
            <span className="muted">{t("Command preview")}</span>
            <Button
              variant="minimal"
              size="small"
              icon={copied ? IconNames.TICK : IconNames.DUPLICATE}
              title={t("Copy")}
              onClick={onCopy}
            />
          </div>
          <Divider />
          <code>{preview}</code>
        </div>
      </div>
    </aside>
  );
};

const StringRows: React.FC<{
  rows: string[];
  onChange: (rows: string[]) => void;
  placeholder: string;
  addLabel: string;
}> = ({ rows, onChange, placeholder, addLabel }) => (
  <>
    {rows.map((row, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: positional rows edited in place
      <div className="kv" key={index}>
        <InputGroup
          placeholder={placeholder}
          value={row}
          onChange={(event) => onChange(rows.map((r, i) => (i === index ? event.target.value : r)))}
        />
        <Button variant="minimal" icon={IconNames.CROSS} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
      </div>
    ))}
    <Button
      variant="minimal"
      size="small"
      icon={IconNames.PLUS}
      text={addLabel}
      onClick={() => onChange([...rows, ""])}
    />
  </>
);

const SecretRows: React.FC<{ rows: BuildSecret[]; onChange: (rows: BuildSecret[]) => void }> = ({ rows, onChange }) => {
  const { t } = useTranslation();
  const update = (index: number, next: Partial<BuildSecret>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  return (
    <>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows edited in place
        <div className="kv" key={index}>
          <InputGroup
            placeholder={t("id")}
            value={row.id}
            onChange={(event) => update(index, { id: event.target.value })}
          />
          <InputGroup
            placeholder={t("src path")}
            value={row.src ?? ""}
            onChange={(event) => update(index, { src: event.target.value })}
          />
          <Button
            variant="minimal"
            icon={IconNames.CROSS}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        variant="minimal"
        size="small"
        icon={IconNames.PLUS}
        text={t("Add secret")}
        onClick={() => onChange([...rows, { id: "", src: "" }])}
      />
    </>
  );
};

const NamedContextRows: React.FC<{ rows: NamedContext[]; onChange: (rows: NamedContext[]) => void }> = ({
  rows,
  onChange,
}) => {
  const { t } = useTranslation();
  const update = (index: number, next: Partial<NamedContext>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  return (
    <>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows edited in place
        <div className="kv" key={index}>
          <InputGroup
            placeholder={t("name")}
            value={row.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <InputGroup
            placeholder={t("value")}
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            variant="minimal"
            icon={IconNames.CROSS}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <Button
        variant="minimal"
        size="small"
        icon={IconNames.PLUS}
        text={t("Add context")}
        onClick={() => onChange([...rows, { name: "", value: "" }])}
      />
    </>
  );
};
