import type { ContainerImage } from "@/env/Types";
import i18n from "@/i18n";
import { type AppBreadcrumb, tabbedCrumbs } from "@/web-app/components/AppBreadcrumbs";
import { pathTo } from "@/web-app/Navigator";

export const getImageUrl = (id: string, view: string, connId?: string) => {
  return pathTo(`/screens/image/${encodeURIComponent(id)}/${encodeURIComponent(view)}`, undefined, { connId });
};

/** The 12-char short id (sha256: prefix stripped) — how `docker`/`podman images` identify an image. */
export const shortImageId = (id?: string): string => (id || "").replace(/^sha256:/, "").slice(0, 12);

/**
 * Human-readable image reference for titles/breadcrumbs: `name:tag` when the image is tagged, otherwise the
 * short id (a dangling `<none>` image). Never the full 64-char sha256 digest, which is unreadable.
 */
export const imageDisplayName = (image: Pick<ContainerImage, "Name" | "Tag" | "FullName" | "Id">): string => {
  if (image.FullName) {
    return image.FullName;
  }
  if (image.Name) {
    return image.Tag ? `${image.Name}:${image.Tag}` : image.Name;
  }
  return shortImageId(image.Id) || "<none>";
};

// Sub-tab label per view segment (keys match the ActionsMenu wording).
const IMAGE_VIEW_LABELS: Record<string, string> = {
  layers: i18n.t("Layers"),
  security: i18n.t("Security"),
};

/** Canonical image trail: `Images > name` on inspect; `Images > name > Tab` on a sub-tab. */
export const getImageCrumbs = (name: string, id: string, currentScreen: string, connId?: string): AppBreadcrumb[] => {
  const view = currentScreen.split(".")[1] ?? "inspect";
  return tabbedCrumbs("images", name, getImageUrl(id, "inspect", connId), connId, IMAGE_VIEW_LABELS[view]);
};
