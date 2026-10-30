import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { memo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PixelMascot } from "@/features/mascots/PixelMascot";
import { ProjectMascot } from "@/features/mascots/ProjectMascot";
import { MONOCODE_MARK } from "@/ui/brand";
import { CircleButton } from "@/ui/CircleButton";
import { GradualBlur } from "@/ui/GradualBlur";
import { isModalRoute } from "@/ui/SceneFade";
import { useDrawerActions, useDrawerOpen } from "@/ui/ScenePager";
import { Shimmer } from "@/ui/Shimmer";
import { radii, themedStyles, useColors } from "@/ui/theme";

import { pickProject } from "./projectPick";
import { projectForRoute } from "./routing";
import type { Mono, Project } from "./types";
import { useWorkspace } from "./WorkspaceProvider";

const HEADER_HEIGHT = 48;
const FOOTER_HEIGHT = 48;
/** How far past the header and footer the blur keeps fading. */
const FADE = 16;
/** Each row's icon slot. A mono's figure fills three quarters of its box
 *  (12 of PIXEL_GRID's 16 units) and a project's all of it, so a project's
 *  mascot is drawn smaller to stand the same height. */
const ICON_SLOT = 24;
const PROJECT_MASCOT = ICON_SLOT * 0.75;

/**
 * The phone's counterpart of the desktop's classic rail: the Monocode mark on
 * top, then the Monos and the projects, the one on screen marked, and
 * settings at the foot. Picking one switches the screen under it as the
 * drawer shuts.
 */
export function WorkspaceDrawer() {
  const drawer = useDrawerActions();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useStyles();
  const { projects, monos } = useWorkspace();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ projectId?: string; monoId?: string }>();
  const onMono = pathname.startsWith("/mono/");
  const onProject = pathname.startsWith("/project/");
  const activeMono = onMono ? params.monoId : undefined;
  const activeProject = onProject
    ? projectForRoute(projects, params.projectId)?.id
    : undefined;

  // The drawer shuts at once over a loading cover, and the next screen is
  // built only once it is shut, so building it can't hitch the motion. Same
  // kind to same kind only swaps the params, so the frame stays mounted.
  const openProject = (id: string) => {
    if (id === activeProject) return drawer.close();
    drawer.closeThen(() => {
      // The project route takes a pick in place; any other screen is replaced.
      if (!pickProject(id))
        router.replace({ pathname: "/project/[projectId]", params: { projectId: id } });
    });
  };
  const openMono = (id: string) => {
    if (id === activeMono) return drawer.close();
    drawer.closeThen(() => {
      if (onMono) router.setParams({ monoId: id });
      else router.replace({ pathname: "/mono/[monoId]", params: { monoId: id } });
    });
  };
  const openSettings = () => {
    drawer.close();
    if (!isModalRoute(pathname)) router.push("/settings");
  };

  const headerTop = insets.top + 6;
  const headerBottom = headerTop + HEADER_HEIGHT + 8;
  const footerBottom = Math.max(insets.bottom, 16);
  const footerTop = footerBottom + FOOTER_HEIGHT + 10;

  return (
    <View style={styles.container}>
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[
          styles.list,
          { paddingTop: headerBottom, paddingBottom: footerTop + FADE },
        ]}
        scrollIndicatorInsets={{ top: headerBottom, bottom: footerTop }}
        showsVerticalScrollIndicator={false}
      >
        {monos.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Monos</Text>
            {monos.map((mono) => (
              <MonoRow
                key={mono.id}
                mono={mono}
                active={mono.id === activeMono}
                onPress={openMono}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Projects</Text>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              active={project.id === activeProject}
              onPress={openProject}
            />
          ))}
          {projects.length ? null : (
            <Text style={styles.empty}>No projects on this phone yet.</Text>
          )}
        </View>
      </ScrollView>

      <GradualBlur edge="top" height={headerBottom + FADE} color={colors.drawer} />
      <GradualBlur edge="bottom" height={footerTop + FADE} color={colors.drawer} />

      <View style={[styles.header, { top: headerTop }]}>
        <Image
          source={MONOCODE_MARK}
          style={[styles.mark, { tintColor: colors.content }]}
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.brandName}>Monocode</Text>
      </View>

      <View style={[styles.footer, { bottom: footerBottom }]}>
        <CircleButton icon="settings" label="Settings" onPress={openSettings} />
      </View>
    </View>
  );
}

/** A Mono: its mascot, and under its name what it is doing, or else its
 *  conversation's last line. */
const MonoRow = memo(function MonoRow({
  mono,
  active,
  onPress,
}: {
  mono: Mono;
  active: boolean;
  onPress: (id: string) => void;
}) {
  const styles = useStyles();
  // The shimmer only runs where it can be seen.
  const shown = useDrawerOpen();
  const detail =
    mono.status === "working"
      ? "Working…"
      : mono.status === "needs-you"
        ? "Needs you"
        : oneLine(mono.lastMessage) || "No messages yet";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mono.name}, ${detail}`}
      accessibilityState={{ selected: active }}
      onPress={() => onPress(mono.id)}
      style={({ pressed }) => [styles.row, (active || pressed) && styles.rowActive]}
    >
      <PixelMascot
        name={mono.mascot}
        color={mono.color}
        status={mono.status}
        size={ICON_SLOT}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {mono.name}
        </Text>
        {mono.status === "working" && shown ? (
          <Shimmer style={styles.rowDetail}>{detail}</Shimmer>
        ) : (
          <Text
            style={[styles.rowDetail, mono.status === "needs-you" && styles.rowNeedsYou]}
            numberOfLines={1}
          >
            {detail}
          </Text>
        )}
      </View>
      {mono.unread > 0 ? <View style={styles.unread} /> : null}
    </Pressable>
  );
});

/** The first line's worth of a message, its line breaks and markdown runs of
 *  spaces folded. */
function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** A project, under its mascot. */
const ProjectRow = memo(function ProjectRow({
  project,
  active,
  onPress,
}: {
  project: Project;
  active: boolean;
  onPress: (id: string) => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={project.name}
      accessibilityState={{ selected: active }}
      onPress={() => onPress(project.id)}
      style={({ pressed }) => [styles.row, (active || pressed) && styles.rowActive]}
    >
      <View style={styles.icon}>
        <ProjectMascot
          project={project.path}
          name={project.mascot}
          color={project.color}
          size={PROJECT_MASCOT}
          active={project.busy}
        />
      </View>
      <Text style={[styles.rowLabel, styles.rowText]} numberOfLines={1}>
        {project.name}
      </Text>
    </Pressable>
  );
});

const useStyles = themedStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.drawer,
  },
  list: {
    paddingHorizontal: 10,
  },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
  },
  mark: {
    width: 28,
    height: 28,
  },
  brandName: {
    color: colors.content,
    fontSize: 17,
    fontWeight: "600",
  },
  section: {
    gap: 2,
    marginBottom: 18,
  },
  // Dimmed heading, inset like the rows' text, as the rail's.
  sectionLabel: {
    paddingHorizontal: 12,
    marginBottom: 4,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.row,
    borderCurve: "continuous",
  },
  icon: {
    width: ICON_SLOT,
    height: ICON_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActive: {
    backgroundColor: colors.selection,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: colors.content,
    fontSize: 17,
  },
  rowDetail: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 1,
  },
  rowNeedsYou: {
    color: colors.caution,
  },
  unread: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  empty: {
    paddingHorizontal: 12,
    paddingTop: 4,
    color: colors.muted,
    fontSize: 15,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
  },
}));
