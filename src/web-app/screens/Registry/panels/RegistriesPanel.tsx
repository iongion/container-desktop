import { Button, HTMLTable, Icon, type IconName, Intent, NonIdealState, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiCubeUnfolded } from "@mdi/js";
import { useCallback, useMemo, useState } from "react";

import type { Registry, RegistryAuthInfo, RegistryTlsState } from "@/env/Types";
import { t } from "@/web-app/App.i18n";
import { AppLabel } from "@/web-app/components/AppLabel";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { EngineCell, engineLabel } from "@/web-app/components/EngineCell";
import type { ConnectionGroup } from "@/web-app/components/groupedTable/flattenConnectionGroups";
import { useGroupedVirtualRows } from "@/web-app/components/groupedTable/useGroupedVirtualRows";
import { SortableColumnHeader } from "@/web-app/components/SortableColumnHeader";
import { VirtualSpacerRow } from "@/web-app/components/VirtualSpacerRow";
import { useShowEngineRowAccent } from "@/web-app/hooks/useMergedResources";
import { AddRegistryDialog } from "../AddRegistryDialog";
import { RegistryLoginDialog } from "../RegistryLoginDialog";
import {
  isPrivateRegistry,
  type RegistryRow,
  type RegistrySort,
  type RegistrySortField,
  registryAuthLabel,
  registryTrustView,
  sortRegistryRows,
} from "../registryTrustView";
import { useAddRegistry, useRegistryLogin, useRegistryLogout, useRemoveRegistry } from "../trustMutations";
import { type ConnectionRegistryGroup, useConnectionRegistryGroups } from "../trustQueries";
import { scopeKey, useTrustStore } from "../trustStore";
import { TrustPill, type TrustPillTone } from "./TrustPill";

// Registries category — GLOBAL, cloning the Containers list's grouped table exactly (same structure: ONE
// .AppDataTable[data-windowed] filling the area with a sticky header, .AppDataTableGroupRow groups, tree-link
// child rows, sortable headers, striped rows) — only the data differs. Login/add/remove run through the
// client trust store until the registries.conf/auth.json backends wire in (handover Steps 3-4).

const TLS_PILL: Record<RegistryTlsState, { tone: TrustPillTone; icon: IconName; label: string }> = {
  verify: { tone: "ok", icon: IconNames.SMALL_TICK, label: "verify" },
  "self-signed": { tone: "warn", icon: IconNames.WARNING_SIGN, label: "self-signed" },
  insecure: { tone: "err", icon: IconNames.WARNING_SIGN, label: "insecure" },
};

const COLUMN_COUNT = 7;

type RegistryVirtualRow = RegistryRow & {
  connectionId: string;
  engine: string;
};

interface RegistryVirtualGroup extends ConnectionGroup<RegistryVirtualRow> {
  connection: ConnectionRegistryGroup["connection"];
}

function AuthPill({ auth }: { auth: RegistryAuthInfo }) {
  const label = registryAuthLabel(auth);
  if (auth.kind === "anonymous") {
    return auth.rateLimited ? <TrustPill tone="warn">{label}</TrustPill> : <TrustPill tone="off">{label}</TrustPill>;
  }
  return (
    <TrustPill tone="ok" icon={auth.kind === "user" ? IconNames.PERSON : IconNames.KEY}>
      {label}
    </TrustPill>
  );
}

// Certificate column — a badge for the CA trust state; self-signed offers the Trust action (its own column).
function CertBadge({ tls }: { tls: RegistryTlsState }) {
  if (tls === "self-signed") {
    return (
      <Button
        className="TrustAction--warn TrustCertAction"
        variant="minimal"
        size="small"
        icon={IconNames.ENDORSED}
        text={t("Trust cert")}
        disabled
        title={t("Import this registry's CA — wired next")}
      />
    );
  }
  if (tls === "insecure") {
    return (
      <TrustPill tone="err" icon={IconNames.WARNING_SIGN}>
        {t("unverified")}
      </TrustPill>
    );
  }
  return <TrustPill tone="off">{t("system CA")}</TrustPill>;
}

export const RegistriesPanel: React.FC = () => {
  const { data: groups = [], isLoading } = useConnectionRegistryGroups();
  const { authOverrides, added, removed, login, logout, addRegistry, removeRegistry, dialog, closeDialog } =
    useTrustStore();
  // Real engine mutations (secret via `--password-stdin`). The trust store keeps the OPTIMISTIC overlay so the
  // mock UI still reflects the change immediately (mock short-circuits getRegistriesMap); on a real engine the
  // hook's query invalidation refetches the true auth.json state.
  const registryLogin = useRegistryLogin();
  const registryLogout = useRegistryLogout();
  const registryAdd = useAddRegistry();
  const registryRemove = useRemoveRegistry();
  const showEngineRowAccent = useShowEngineRowAccent();
  const [sort, setSort] = useState<RegistrySort | undefined>();
  const [loginTarget, setLoginTarget] = useState<{ connectionId: string; name: string } | null>(null);

  const toggleSort = useCallback((field: string) => {
    setSort((prev) =>
      prev?.field === field
        ? { field: field as RegistrySortField, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field: field as RegistrySortField, dir: "asc" },
    );
  }, []);
  const dir = (field: string) => (sort?.field === field ? sort.dir : undefined);

  // Merge fetched registries with session add/remove/login overlays, then build the sortable rows per group.
  const rowsFor = useCallback(
    (connectionId: string, fetched: Registry[]): RegistryRow[] => {
      const extra: Registry[] = (added[connectionId] ?? []).map((r) => ({
        id: r.name,
        name: r.name,
        created: "",
        weight: 0,
        enabled: true,
        isRemovable: true,
        isSystem: false,
        engine: [],
        tls: r.tls,
        mirrorOf: r.mirrorOf,
      }));
      const merged = [...fetched, ...extra].filter((r) => !removed[scopeKey(connectionId, r.name)]);
      const rows = merged.map((registry, index) => {
        const override = authOverrides[scopeKey(connectionId, registry.name)];
        const effective = override ? { ...registry, auth: override } : registry;
        return { registry, view: registryTrustView(effective, index) };
      });
      return sortRegistryRows(rows, sort);
    },
    [added, authOverrides, removed, sort],
  );
  const registryGroups = useMemo<RegistryVirtualGroup[]>(
    () =>
      groups.map((group) => ({
        key: group.connection.id,
        connection: group.connection,
        items: rowsFor(group.connection.id, group.registries).map((row) => ({
          ...row,
          connectionId: group.connection.id,
          engine: group.connection.engine,
        })),
      })),
    [groups, rowsFor],
  );
  const { items, paddingTop, paddingBottom, measureRef, scrollElementRef, theadRef, isCollapsed, onGroupToggleClick } =
    useGroupedVirtualRows({
      groups: registryGroups,
      getRowKey: (row, group) => `${group.key}:${row.registry.id}`,
    });

  return (
    <div className="TrustPanel">
      {isLoading ? (
        <NonIdealState title={<Spinner size={28} />} />
      ) : groups.length === 0 ? (
        <NonIdealState
          icon={IconNames.BOOK}
          title={t("No connected engines")}
          description={t("Connect an engine to manage its registries and sign-in.")}
        />
      ) : (
        <div className="TrustTableScroll" ref={scrollElementRef}>
          <HTMLTable
            compact
            interactive
            className="AppDataTable TrustTable"
            data-windowed="true"
            data-table="trust-registries"
          >
            <thead ref={theadRef}>
              <tr>
                <SortableColumnHeader field="registry" direction={dir("registry")} onSort={toggleSort}>
                  <AppLabel iconPath={mdiCubeUnfolded} text={t("Registry")} />
                </SortableColumnHeader>
                <SortableColumnHeader field="tls" direction={dir("tls")} onSort={toggleSort}>
                  {t("TLS")}
                </SortableColumnHeader>
                <SortableColumnHeader field="authentication" direction={dir("authentication")} onSort={toggleSort}>
                  {t("Authentication")}
                </SortableColumnHeader>
                <SortableColumnHeader field="certificate" direction={dir("certificate")} onSort={toggleSort}>
                  {t("Certificate")}
                </SortableColumnHeader>
                <SortableColumnHeader field="mirror" direction={dir("mirror")} onSort={toggleSort}>
                  {t("Mirror of")}
                </SortableColumnHeader>
                <SortableColumnHeader field="order" direction={dir("order")} onSort={toggleSort}>
                  {t("Order")}
                </SortableColumnHeader>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              <VirtualSpacerRow height={paddingTop} columnCount={COLUMN_COUNT} />
              {items.map(({ row: descriptor, index, key }) => {
                const striped = index % 2 === 0 ? "true" : undefined;
                if (descriptor.kind === "group-header") {
                  const group = descriptor.group as RegistryVirtualGroup;
                  const connectionId = group.connection.id;
                  const isGroupCollapsed = isCollapsed(connectionId);
                  return (
                    <tr
                      key={key}
                      ref={measureRef}
                      data-index={index}
                      className="AppDataTableGroupRow"
                      data-engine-row={showEngineRowAccent ? group.connection.engine : undefined}
                    >
                      <td className="AppDataTableGroupName" colSpan={COLUMN_COUNT}>
                        <Button
                          fill
                          variant="minimal"
                          icon={isGroupCollapsed ? IconNames.CARET_RIGHT : IconNames.CARET_DOWN}
                          onClick={onGroupToggleClick}
                          data-prefix-group={connectionId}
                          title={t("{{name}} registries", { name: group.connection.name })}
                          text={
                            <>
                              <EngineCell engine={group.connection.engine} connectionName={group.connection.name} />
                              <span className="buttonTextLabel">{group.connection.name}</span>
                              <span className="TrustGroupMeta">{engineLabel(group.connection.engine)}</span>
                              <span className="TrustGroupSum">
                                {group.items.length} {group.items.length === 1 ? t("registry") : t("registries")}
                              </span>
                            </>
                          }
                        />
                      </td>
                    </tr>
                  );
                }
                const { registry, view, connectionId, engine } = descriptor.item;
                const tls = TLS_PILL[view.tls];
                const linkLocation = descriptor.isFirst ? "first" : descriptor.isLast ? "last" : undefined;
                return (
                  <tr
                    key={key}
                    ref={measureRef}
                    data-index={index}
                    data-prefix-group={connectionId}
                    data-striped={striped}
                    data-engine-row={showEngineRowAccent ? engine : undefined}
                  >
                    <td>
                      <div className="AppDataTableGroupLink" data-link-location={linkLocation}>
                        <div className="AppDataTableGroupLinkVertical" />
                        <div className="AppDataTableGroupLinkHorizontal" />
                      </div>
                      <span className="TrustRegName">
                        <Icon icon={IconNames.CUBE} size={14} />
                        <span className="TrustRegNameText">{registry.name}</span>
                        {isPrivateRegistry(registry.name) ? <span className="TrustRegSub">{t("private")}</span> : null}
                      </span>
                    </td>
                    <td>
                      <TrustPill tone={tls.tone} icon={tls.icon}>
                        {t(tls.label)}
                      </TrustPill>
                    </td>
                    <td>
                      <AuthPill auth={view.auth} />
                    </td>
                    <td>
                      <CertBadge tls={view.tls} />
                    </td>
                    <td>
                      {view.mirrorOf ? (
                        <span className="TrustMono">{view.mirrorOf}</span>
                      ) : (
                        <span className="TrustMuted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="TrustOrder">{view.order}</span>
                    </td>
                    <td data-column="Actions">
                      <div className="TrustRowActions">
                        <Button
                          className="TrustActionAuth"
                          variant="minimal"
                          size="small"
                          intent={view.loggedIn ? Intent.SUCCESS : Intent.NONE}
                          text={view.loggedIn ? t("Log out") : t("Log in")}
                          onClick={() => {
                            if (view.loggedIn) {
                              logout(connectionId, registry.name);
                              registryLogout.mutate({ connectionId, registry: registry.name });
                            } else {
                              setLoginTarget({ connectionId, name: registry.name });
                            }
                          }}
                        />
                        <ConfirmMenu
                          tag={{ connectionId, name: registry.name }}
                          title={t("Remove {{name}}?", { name: registry.name })}
                          onConfirm={(tagValue, confirmed) => {
                            if (confirmed) {
                              removeRegistry(tagValue.connectionId, tagValue.name);
                              registryRemove.mutate({
                                connectionId: tagValue.connectionId,
                                name: tagValue.name,
                              });
                            }
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              <VirtualSpacerRow height={paddingBottom} columnCount={COLUMN_COUNT} />
            </tbody>
          </HTMLTable>
        </div>
      )}

      {loginTarget ? (
        <RegistryLoginDialog
          registry={loginTarget.name}
          connectionId={loginTarget.connectionId}
          onClose={() => setLoginTarget(null)}
          onSubmit={(auth, secret) => {
            login(loginTarget.connectionId, loginTarget.name, auth);
            registryLogin.mutate({
              connectionId: loginTarget.connectionId,
              registry: loginTarget.name,
              username: auth.account ?? "",
              secret,
            });
            setLoginTarget(null);
          }}
        />
      ) : null}
      {dialog === "add-registry" ? (
        <AddRegistryDialog
          onClose={closeDialog}
          onSubmit={(connectionId, registry) => {
            addRegistry(connectionId, registry);
            registryAdd.mutate({ connectionId, registry });
            closeDialog();
          }}
        />
      ) : null}
    </div>
  );
};
