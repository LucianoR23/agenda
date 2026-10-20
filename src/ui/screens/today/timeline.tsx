"use client";

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { animate, motion, type PanInfo, useMotionValue, useTransform } from "motion/react";
import { Fragment, useMemo, useRef, useState } from "react";
import type { Block } from "@/client/types";
import { BLOCK_TYPES, typeColor } from "../../block-types";
import { BlockCard, NowLine } from "../../components/block-card";
import { Icon } from "../../components/icon";
import { blockTime } from "../../format";
import { haptic } from "../../time";

export const THRESHOLD = 96;

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const snap = (m: number, up = true) => (up ? Math.ceil(m / 15) * 15 : Math.floor(m / 15) * 15);
const duration = (b: Block) => (b.end ? (mins(b.end) - mins(b.start) + 24 * 60) % (24 * 60) : 0);

/** Where a block lands when dropped between `prev` and `next`: right after prev (snap 15), else right before next. */
export function dropTime(b: Block, prev: Block | undefined, next: Block | undefined): { start: string; end: string | null } {
  let start: number;
  if (prev) start = snap(prev.end && mins(prev.end) >= mins(prev.start) ? mins(prev.end) : mins(prev.start) + 15);
  else if (next) start = snap(mins(next.start) - Math.max(15, duration(b)), false);
  else start = mins(b.start);
  start = Math.max(0, Math.min(start, 29 * 60 + 45));
  const d = duration(b);
  return { start: hhmm(start), end: b.end ? hhmm(Math.min(start + d, 29 * 60 + 59)) : null };
}

/** Swipe right = done, left = skipped; the color is revealed with icon + text. */
function Swipeable({ block, onSwipe, children }: { block: Block; onSwipe: (s: "done" | "skipped") => void; children: React.ReactNode }) {
  const x = useMotionValue(0);
  const doneOpacity = useTransform(x, [0, 24, THRESHOLD], [0, 0.6, 1]);
  const skipOpacity = useTransform(x, [-THRESHOLD, -24, 0], [1, 0.6, 0]);
  const crossed = useRef<0 | 1 | -1>(0);
  const dragged = useRef(false);
  const enabled = block.status === "pending";

  return (
    <div className="relative">
      {enabled && (
        <>
          <motion.div style={{ opacity: doneOpacity }} className="absolute inset-y-0 left-[62px] right-0 flex items-center rounded-lg bg-success pl-4 text-on-success">
            <span className="flex items-center gap-1.5 text-body-sm font-semibold">
              <Icon name="check_circle" /> Hecho
            </span>
          </motion.div>
          <motion.div style={{ opacity: skipOpacity }} className="absolute inset-y-0 left-[62px] right-0 flex items-center justify-end rounded-lg bg-raised pr-4 text-text">
            <span className="flex items-center gap-1.5 text-body-sm font-semibold">
              <Icon name="do_not_disturb_on" /> Salteado
            </span>
          </motion.div>
        </>
      )}
      <motion.div
        style={{ x }}
        drag={enabled ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragStart={() => (dragged.current = true)}
        onDrag={(_: unknown, info: PanInfo) => {
          const zone = info.offset.x > THRESHOLD ? 1 : info.offset.x < -THRESHOLD ? -1 : 0;
          if (zone !== crossed.current) {
            if (zone !== 0) haptic(15);
            crossed.current = zone;
          }
        }}
        onDragEnd={(_: unknown, info: PanInfo) => {
          crossed.current = 0;
          if (info.offset.x > THRESHOLD) onSwipe("done");
          else if (info.offset.x < -THRESHOLD) onSwipe("skipped");
          void animate(x, 0, { duration: 0.2 });
          setTimeout(() => (dragged.current = false), 0);
        }}
        // a swipe must not also open the editor
        onClickCapture={(e) => dragged.current && e.stopPropagation()}
        className="relative"
        data-testid={`block-${block.id}`}
      >
        {children}
      </motion.div>
    </div>
  );
}

function SortableBlock({
  block,
  onOpen,
  onSwipe,
  placeholder,
  liftedHeight,
}: {
  block: Block;
  onOpen: () => void;
  onSwipe: (s: "done" | "skipped") => void;
  placeholder?: string | null;
  /** Height of the card when it was lifted: the drop slot keeps it, so nothing jumps (or scroll-anchors) on lift. */
  liftedHeight?: number;
}) {
  const movable = block.source !== "calendar" && !block.locked && block.status === "pending";
  // only pointer listeners: dnd-kit's keyboard-sorting attributes would mark fixed blocks as aria-disabled
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !movable });
  const style = { transform: CSS.Translate.toString(transform), transition };
  if (isDragging)
    return (
      <div ref={setNodeRef} style={style} className="grid grid-cols-[50px_1fr] gap-3">
        <span />
        <div style={{ height: liftedHeight ?? 64 }} className="flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-border2 text-caption text-muted">
          Soltá acá{placeholder ? ` · ${placeholder}` : ""}
        </div>
      </div>
    );
  return (
    // no long-press callout / context menu (Android shows one on links), it would steal the gesture
    <div ref={setNodeRef} style={style} {...listeners} onContextMenu={(e) => movable && e.preventDefault()} className="touch-pan-y select-none [-webkit-touch-callout:none]">
      <Swipeable block={block} onSwipe={onSwipe}>
        <BlockCard block={block} onOpen={onOpen} />
      </Swipeable>
    </div>
  );
}

/** The lifted card while dragging (rotate −1.2°, raised, shadow). */
function Lifted({ block }: { block: Block }) {
  const t = BLOCK_TYPES[block.type];
  return (
    <div className="grid grid-cols-[50px_1fr] gap-3">
      <span />
      <div className="flex h-16 -translate-y-1.5 -rotate-[1.2deg] items-center gap-2.5 rounded-lg bg-raised pr-2 pl-3.5 text-text shadow-calma">
        <Icon name={t.icon} color={typeColor(block.type)} />
        <span className="flex-1 text-body">{block.title}</span>
        <span className="flex size-11 items-center justify-center text-muted">
          <Icon name="drag_indicator" size={22} />
        </span>
      </div>
    </div>
  );
}

export function Timeline({
  blocks,
  nowTime,
  onOpen,
  onSwipe,
  onMove,
}: {
  blocks: Block[];
  /** `HH:mm` when this is today's timeline (draws the now line). */
  nowTime: string | null;
  onOpen: (b: Block) => void;
  onSwipe: (b: Block, s: "done" | "skipped") => void;
  onMove: (b: Block, to: { start: string; end: string | null } | null, orderedIds: string[]) => void;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [active, setActive] = useState<Block | null>(null);
  const [liftedHeight, setLiftedHeight] = useState<number | undefined>(undefined);
  const [overId, setOverId] = useState<string | null>(null);
  // Touch: long press (350 ms, finger still) lifts the card; moving earlier is a normal scroll. TouchSensor (not
  // PointerSensor) because once lifted it cancels the touchmove, so the browser neither scrolls nor fires pointercancel.
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { delay: 350, tolerance: 6 } }),
  );

  const ids = order ?? blocks.map((b) => b.id);
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const list = ids.map((id) => byId.get(id)).filter((b): b is Block => !!b);

  const preview = (() => {
    if (!active || !overId) return null;
    const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(overId));
    const i = moved.indexOf(active.id);
    return dropTime(active, byId.get(moved[i - 1] ?? ""), byId.get(moved[i + 1] ?? ""));
  })();

  const nowIndex = nowTime ? list.findIndex((b) => blockTime(b.start).nextDay || b.start > nowTime) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => {
        haptic(20);
        setActive(byId.get(String(e.active.id)) ?? null);
        // dnd-kit has not measured the node yet at this point (rect.initial is null): read it from the DOM
        setLiftedHeight(document.querySelector(`[data-testid="block-${e.active.id}"]`)?.getBoundingClientRect().height);
        setOrder(blocks.map((b) => b.id));
      }}
      onDragOver={(e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null)}
      onDragCancel={() => (setActive(null), setOrder(null))}
      onDragEnd={(e: DragEndEvent) => {
        const a = active;
        setActive(null);
        setOverId(null);
        setOrder(null);
        if (!a || !e.over || e.over.id === e.active.id) return;
        const moved = arrayMove(ids, ids.indexOf(a.id), ids.indexOf(String(e.over.id)));
        const i = moved.indexOf(a.id);
        const to = dropTime(a, byId.get(moved[i - 1] ?? ""), byId.get(moved[i + 1] ?? ""));
        onMove(a, to.start === a.start ? null : to, moved);
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2" data-testid="timeline">
          {list.map((b, i) => (
            <Fragment key={b.id}>
              {i === nowIndex && nowTime && <NowLine time={nowTime} />}
              <SortableBlock block={b} onOpen={() => onOpen(b)} onSwipe={(s) => onSwipe(b, s)} placeholder={active?.id === b.id ? preview?.start && blockTime(preview.start).text : null} liftedHeight={active?.id === b.id ? liftedHeight : undefined} />
            </Fragment>
          ))}
          {nowTime && nowIndex === -1 && list.length > 0 && <NowLine time={nowTime} />}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" }}>{active ? <Lifted block={active} /> : null}</DragOverlay>
    </DndContext>
  );
}
