import { router, useLocalSearchParams } from "expo-router";
import { Fragment } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { PixelMascot } from "@/features/mascots/PixelMascot";
import { ProjectMascot } from "@/features/mascots/ProjectMascot";
import { openDocument } from "@/features/sessions/MonoCards";
import { SettingsPage, SettingsRow } from "@/features/settings/SettingsUI";
import { useMonoProfile, type MonoProfile } from "@/features/workspace/monoProfile";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

// A Mono's profile, as the desktop's details sidebar has it without its
// Changes: who it is, with Edit under, then its day, its contributions, what
// it does next, the documents it wrote and the projects it works in.
export default function MonoProfileScreen() {
  const { monoId } = useLocalSearchParams<{ monoId: string }>();
  const { monos, projects } = useWorkspace();
  const mono = monos.find((m) => m.id === monoId);
  const { profile, error, refreshing, refresh } = useMonoProfile(monoId);
  const styles = useStyles();
  const colors = useColors();
  if (!mono) return null;
  const assigned = projects.filter((project) => mono.projectIds.includes(project.id));
  return (
    <SettingsPage onRefresh={refresh} refreshing={refreshing}>
      <View style={styles.identity}>
        <PixelMascot name={mono.mascot} color={mono.color} status={mono.status} size={88} />
        <Text style={styles.name} numberOfLines={1}>{mono.name}</Text>
        {profile ? <Text style={styles.status} numberOfLines={2}>{profile.status}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/mono-profile/[monoId]/edit", params: { monoId } })}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
        >
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
      </View>

      {profile ? (
        <Overview profile={profile} name={mono.name} />
      ) : error ? (
        <Text style={styles.note}>{error}</Text>
      ) : (
        <ActivityIndicator color={colors.muted} style={styles.loading} />
      )}

      <Text style={styles.heading}>Projects</Text>
      <View style={styles.card}>
        {assigned.length ? (
          assigned.map((project, index) => (
            <Fragment key={project.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <SettingsRow
                icon={<ProjectMascot project={project.id} color={project.color} name={project.mascot} />}
                label={project.name}
                showChevron={false}
              />
            </Fragment>
          ))
        ) : (
          <Text style={styles.empty}>Not assigned to a project. It works from your home folder.</Text>
        )}
      </View>
    </SettingsPage>
  );
}

function Overview({ profile, name }: { profile: MonoProfile; name: string }) {
  const styles = useStyles();
  const colors = useColors();
  const { today, contributions } = profile;
  return (
    <>
      <Text style={styles.heading}>Today</Text>
      <View style={styles.tiles}>
        <Tile value={String(today.merged)} label="PRs merged" />
        <Tile
          value={
            <Text style={styles.figure}>
              <Text style={{ color: colors.additions }}>+{today.additions.toLocaleString()}</Text>
              <Text style={{ color: colors.deletions }}> −{today.deletions.toLocaleString()}</Text>
            </Text>
          }
          label="Lines changed"
        />
        <Tile value={String(today.sessions)} label="Sessions" />
        <Tile value={`${today.habitsRan}/${today.habitsTotal}`} label="Habits run" />
      </View>

      <Text style={styles.heading}>Contributions</Text>
      <View style={[styles.card, styles.padded]}>
        <View style={styles.contributionsLine}>
          <Text style={styles.total}>{contributions.total.toLocaleString()}</Text>
          <Text style={styles.caption}>in the last 6 months</Text>
          {contributions.streak > 1 ? (
            <Text style={[styles.caption, styles.streak]}>{contributions.streak}-day streak</Text>
          ) : null}
        </View>
        <Graph levels={contributions.levels} />
      </View>

      <Text style={styles.heading}>Up next</Text>
      <View style={styles.card}>
        {profile.upNext.length ? (
          profile.upNext.map((habit, index) => (
            <Fragment key={habit.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.listRow}>
                <Icon name={habit.running ? "terminal" : "automation"} size={18} color={colors.content} />
                <View style={styles.listText}>
                  <Text style={styles.listTitle} numberOfLines={1}>{habit.name}</Text>
                  <Text style={styles.listDetail} numberOfLines={1}>{habit.schedule}</Text>
                </View>
                <Text style={styles.listDetail}>{habit.when}</Text>
              </View>
            </Fragment>
          ))
        ) : (
          <Text style={styles.empty}>Nothing scheduled. Ask {name} to put recurring work on a habit.</Text>
        )}
      </View>

      <Text style={styles.heading}>Documents</Text>
      <View style={styles.card}>
        {profile.documents.length ? (
          profile.documents.map((document, index) => (
            <Fragment key={document.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${document.title}`}
                onPress={() => openDocument(document.id, document.title)}
                style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
              >
                <Icon
                  name={["html", "visual"].includes(document.kind) ? "metrics" : "edit"}
                  size={18}
                  color={colors.content}
                />
                <View style={styles.listText}>
                  <Text style={styles.listTitle} numberOfLines={1}>{document.title}</Text>
                  {document.summary ? (
                    <Text style={styles.listDetail} numberOfLines={2}>{document.summary}</Text>
                  ) : null}
                </View>
                <Text style={styles.listDetail}>{ago(document.updatedAt)}</Text>
              </Pressable>
            </Fragment>
          ))
        ) : (
          <Text style={styles.empty}>No documents yet.</Text>
        )}
      </View>
    </>
  );
}

function Tile({ value, label }: { value: string | React.ReactElement; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      {typeof value === "string" ? <Text style={styles.figure}>{value}</Text> : value}
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

/** The desktop's contributions calendar: a column per week from a Sunday,
 *  each day a square in the accent, stronger the busier it was. */
function Graph({ levels }: { levels: number[] }) {
  const styles = useStyles();
  const colors = useColors();
  const weeks: number[][] = [];
  for (let at = 0; at < levels.length; at += 7) weeks.push(levels.slice(at, at + 7));
  return (
    <View style={styles.graph}>
      {weeks.map((week, column) => (
        <View key={column} style={styles.week}>
          {week.map((level, row) => (
            <View
              key={row}
              style={[
                styles.day,
                {
                  backgroundColor:
                    level === 0 ? withAlpha(colors.content, 0.06) : withAlpha(colors.accent, 0.25 + level * 0.1875),
                },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** How long ago, in the desktop's short form: now, 5m, 3h, 2d. */
function ago(ms: number) {
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const useStyles = themedStyles((colors) => ({
  identity: {
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  name: {
    marginTop: 6,
    color: colors.content,
    fontSize: 24,
    fontWeight: "700",
  },
  status: {
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  edit: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  editLabel: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.6,
  },
  loading: {
    marginTop: 32,
  },
  heading: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 16,
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
    marginHorizontal: 16,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  padded: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 40,
    backgroundColor: colors.stroke,
  },
  empty: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  figure: {
    color: colors.content,
    fontSize: 22,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  caption: {
    color: colors.muted,
    fontSize: 13,
  },
  contributionsLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  total: {
    color: colors.content,
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  streak: {
    marginLeft: "auto",
  },
  graph: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  week: {
    gap: 3,
  },
  day: {
    width: 9,
    height: 9,
    borderRadius: 2,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 11,
  },
  listText: {
    flex: 1,
    gap: 2,
  },
  listTitle: {
    color: colors.content,
    fontSize: 16,
  },
  listDetail: {
    color: colors.muted,
    fontSize: 13,
  },
}));
