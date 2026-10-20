import { m } from '@manga/i18n'
import {
  BUBBLE_DASH,
  type Bubble,
  type BubbleGeometry,
  bubbleGroups,
  bubbleTextBox,
  bubbleTypeface,
  clipTextBox,
  cornerAnchor,
  currentArt,
  effectInk,
  effectLines,
  type FocusPoint,
  frameOutline,
  groundColor,
  hasFrameLine,
  type ID,
  innerFrameOf,
  OVERLAY_COLORS,
  type Page,
  type Panel,
  type Point,
  paintOrder,
  panelTone,
  type ReadingDirection,
  type Rect,
  type ReferenceImage,
  SFX_OUTLINE,
  SFX_TYPEFACE,
  sceneHeading,
  sfxFontSize,
  sfxLetterings,
  softEdgeStrokes,
  TONE_MATRICES,
} from '@manga/schema'
import { memo, Suspense, use, useState } from 'react'
import { type AssetState, loadAsset } from './asset'
import { type Box, type BubblePaths, bubbleGeometry, bubblePaths, neckPath } from './bubble-shape'
import { type PagePoint, panelBox, panelPolygon, polygonPoints } from './hit-test'
import type { Selection } from './types'
import {
  EMPHASIS_MARK,
  layoutUnbroken,
  layoutVertical,
  RUBY_SCALE,
  type VerticalLayout,
} from './vertical-text'

export const FONT_FAMILY = '"Noto Sans JP", sans-serif'
/**
 * セリフの書体ごとの字族と太さ。太さは書き出しの @manga/render と揃える。書き出しは同梱のフォントで描く。
 * エディタは数 MB のフォントを読み込まずに開けるよう、入っていなければ OS の同じ系統の書体で代える。
 * 手書き風は OS にほぼ入っていないので、使うページを開いたときに apps/web が同じフォントを読み込む
 */
const TYPEFACES: Record<NonNullable<Bubble['typeface']>, { family: string; weight: number }> = {
  gothic: { family: FONT_FAMILY, weight: 400 },
  bold: { family: FONT_FAMILY, weight: 700 },
  mincho: {
    family: '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif',
    weight: 400,
  },
  rounded: {
    family: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif',
    weight: 400,
  },
  hand: { family: '"Yomogi", Klee, sans-serif', weight: 400 },
}
/** 選択やコマ番号など、出力に出ない作業用の色。値は @manga/ui の tokens.css が持つ */
export const GUIDE = 'var(--guide)'
const NOTE_COLOR = 'var(--note)'
const NUMBER_RADIUS = 3.2
/** 未生成のコマの指示メモとシーンの見出しの文字の大きさ（mm） */
const NOTE_FONT = 2.6
const NOTE_PAD = 1.5
/**
 * これより小さいセリフは読めないとして警告する（mm）。印刷で読める下限とされる 7pt（約 2.47mm）。
 * 割り付けの下限 2mm まで縮めるのは、警告を出しつつ配置は崩さないため
 */
const LEGIBLE_FONT = 2.47
const ALERT_RADIUS = 2.4
/** フキダシの輪郭の太さ（画面の px） */
const BUBBLE_STROKE = 2

interface PageLayerProps {
  page: Page
  /** ページの大きさ（mm）。SVG のユーザー単位 */
  width: number
  height: number
  /** 綴じの向き。シーンの見出しを読み始めの側の隅に出す */
  direction: ReadingDirection
  showArt: boolean
  /** 参考画像のレイヤーを出すか。出しても `page.reference.visible` が false なら隠す */
  showReference: boolean
  resolveAsset(ref: string): Promise<string>
  generating: Set<ID>
  generatingPage: boolean
  selection: Selection
  /** clipPath の id の接頭辞。同じ文書に複数のキャンバスがあっても衝突しない値 */
  idPrefix: string
  onGenerate?(panelId: ID): void
}

/**
 * ページの白地、参考画像、コマ、生成画像、sfx の焦点の描き文字、フキダシと、紙面全体に重ねるトーンを描く。
 * ズームとパンとドラッグでは props が変わらないので、memo で再描画を飛ばす。コマ、フキダシ、オーバーレイもそれぞれ memo し、編集や選択の変更では
 * 変わった要素だけを描き直す
 */
export const PageLayer = memo(function PageLayer(props: PageLayerProps) {
  const { page, width, height } = props
  const frame = innerFrameOf(page)
  const panels = paintOrder(page.panels)
  // 参考画像を未生成のコマ越しに見せたいので、白い地は下敷きのあるページか黒い地のページの枠ありのコマにだけ塗る
  const opaque = page.ground === 'black' || page.panels.some((p) => p.frame === 'none')
  const ground = groundColor(page)
  const unit = page.spread ? width / 2 : width
  const toneIdOf = (tone: Page['tone']) => tone && `${props.idPrefix}-tone-${tone}`
  const tones = [...new Set(page.panels.flatMap((panel) => panelTone(page, panel) ?? []))]
  return (
    <g data-layer="page">
      {tones.map((tone) => (
        <filter key={tone} id={toneIdOf(tone)} colorInterpolationFilters="sRGB" data-tone={tone}>
          <feColorMatrix type="matrix" values={TONE_MATRICES[tone].join(' ')} />
        </filter>
      ))}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={ground}
        data-ground={page.ground ?? 'white'}
        style={{ stroke: 'var(--paper-edge)' }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {props.showReference && page.reference && (
        <ReferenceView
          reference={page.reference}
          resolveAsset={props.resolveAsset}
          width={width}
          height={height}
        />
      )}
      {panels.map((panel, i) => {
        const ref = currentArt(panel)?.ref
        const { selection } = props
        return (
          <PanelView
            key={panel.id}
            panel={panel}
            width={width}
            height={height}
            direction={props.direction}
            frame={frame}
            artRef={props.showArt ? ref : undefined}
            resolveAsset={props.resolveAsset}
            generating={props.generating.has(panel.id)}
            selected={isSelected(selection, 'panel', panel.id)}
            // 他のコマのフキダシを選んでもこのコマを描き直さないよう、自分のフキダシのときだけ渡す
            selectedBubble={
              selection?.kind === 'bubble' && panel.bubbles.some((b) => b.id === selection.id)
                ? selection.id
                : undefined
            }
            clipId={`${props.idPrefix}-clip-${i}`}
            opaque={opaque && panel.frame !== 'none'}
            unit={unit}
            ground={ground}
            toneId={toneIdOf(panelTone(page, panel))}
          />
        )
      })}
      {/* はみ出したフキダシを後ろのコマが隠さないよう、全コマの後に描く。重なりの前後はレンダラと同じくコマの重なり順 */}
      {panels.map((panel) =>
        overflowGroups(panel, true).map((group) => (
          <BubbleGroupView
            key={group[0]?.id}
            group={group}
            panelRect={panel.rect}
            width={width}
            height={height}
            frame={frame}
            selectedId={props.selection?.kind === 'bubble' ? props.selection.id : undefined}
          />
        )),
      )}
      {page.overlay && (
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={OVERLAY_COLORS[page.overlay]}
          data-overlay={page.overlay}
          style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
        />
      )}
      {/* スピナーと生成ボタンはエディタだけの UI なので、フキダシに隠れないよう最後に描く */}
      {panels.map((panel) => (
        <PanelOverlay
          key={panel.id}
          panelId={panel.id}
          panelRect={panel.rect}
          panelShape={panel.shape}
          width={width}
          height={height}
          generating={!props.generatingPage && props.generating.has(panel.id)}
          onGenerate={props.generatingPage ? undefined : props.onGenerate}
        />
      ))}
      {props.generatingPage && (
        <GeneratingOverlay
          rect={{ x: 0, y: 0, w: width, h: height }}
          points={`0,0 ${width},0 ${width},${height} 0,${height}`}
          label={m.editor_canvas_page_generating()}
        />
      )}
    </g>
  )
})

/** 枠線の点線。破線の枠は黒の破線、線を引かない枠は作業用の細かい点線。選択中は実線 */
function frameDash(frame: Panel['frame'], selected: boolean): string | undefined {
  if (selected) return undefined
  if (frame === 'dashed') return '6 3'
  return hasFrameLine(frame) ? undefined : '4 3'
}

/** 効果線の多角形の列を、1 つの path の d 属性にする */
const effectPath = (lines: readonly (readonly PagePoint[])[]): string =>
  lines.map((line) => `M${line.map((p) => `${p.x},${p.y}`).join('L')}Z`).join('')

const isSelected = (selection: Selection, kind: 'panel' | 'bubble', id: ID) =>
  selection?.kind === kind && selection.id === id

/**
 * コマのフキダシの組（bubbleGroups）のうち、overflow が合うもの。つないだ組は 1 つの輪郭なので、
 * 先頭のフキダシの overflow に従って組ごとに振り分ける（書き出しと同じ）
 */
const overflowGroups = (panel: Panel, overflow: boolean) =>
  bubbleGroups(panel.bubbles).filter((group) => (group[0]?.overflow === true) === overflow)

const PanelView = memo(function PanelView({
  panel,
  width,
  height,
  direction,
  frame,
  artRef,
  resolveAsset,
  generating,
  selected,
  selectedBubble,
  clipId,
  opaque,
  unit,
  ground,
  toneId,
}: {
  panel: Panel
  width: number
  height: number
  direction: ReadingDirection
  frame: Rect
  artRef: string | undefined
  resolveAsset(ref: string): Promise<string>
  generating: boolean
  selected: boolean
  selectedBubble: ID | undefined
  clipId: string
  /** 下に敷いた枠なしのコマか黒い紙の地を隠す白い地を塗るか */
  opaque: boolean
  /** 1 ページの幅（mm）。枠の形の大きさを決める */
  unit: number
  /** 紙の地の色。ぼかし枠はこの色へぼかす */
  ground: string
  /** 絵に掛ける色調の filter の id。色調が無ければ undefined */
  toneId: string | undefined
}) {
  const rect = panelBox(panel, width, height)
  const outline = frameOutline(panelPolygon(panel, width, height), panel.frame, unit)
  const points = polygonPoints(outline)
  const line = hasFrameLine(panel.frame)
  const scene = sceneHeading(panel)
  const sfx = sfxLetterings(panel)
  const placeholder = (
    <g clipPath={`url(#${clipId})`}>
      <Placeholder panel={panel} rect={rect} error={false} />
    </g>
  )
  return (
    <g className="ec-panel" data-panel-id={panel.id} data-generating={generating || undefined}>
      <clipPath id={clipId}>
        <polygon points={points} />
      </clipPath>
      {panel.fill === 'black' ? (
        <polygon points={points} fill="#000" data-panel-fill="black" />
      ) : (
        opaque && <polygon points={points} fill="#fff" data-panel-fill="white" />
      )}
      {artRef === undefined ? (
        placeholder
      ) : (
        <Suspense fallback={placeholder}>
          <PanelArt
            key={artRef}
            panel={panel}
            rect={rect}
            clipId={clipId}
            toneId={toneId}
            loaded={loadAsset(resolveAsset, artRef)}
          />
        </Suspense>
      )}
      {panel.effect && (
        <path
          d={effectPath(effectLines(panel, rect, unit))}
          fill={effectInk(panel)}
          clipPath={`url(#${clipId})`}
          data-panel-effect={panel.effect}
        />
      )}
      {panel.frame === 'soft' && (
        <g clipPath={`url(#${clipId})`} data-soft-edge="">
          {softEdgeStrokes(unit).map(({ width: w, alpha }) => (
            <polygon
              key={w}
              points={points}
              fill="none"
              stroke={ground}
              strokeOpacity={alpha}
              strokeWidth={w}
              strokeLinejoin="round"
            />
          ))}
        </g>
      )}
      {sfx.length > 0 && (
        <g clipPath={`url(#${clipId})`}>
          {sfx.map((focus) => (
            <SfxView key={focus.id} focus={focus} panel={rect} />
          ))}
        </g>
      )}
      <PanelNumber order={panel.order} outline={outline} locked={panel.locked === true} />
      {scene !== undefined && (
        <g clipPath={`url(#${clipId})`}>
          <SceneLabel heading={scene} outline={outline} direction={direction} />
        </g>
      )}
      {/* 枠の外に出た部分をコマの輪郭で切り、切り口に枠線が重なるよう枠より先に描く */}
      {overflowGroups(panel, false).map((group) => (
        <BubbleGroupView
          key={group[0]?.id}
          group={group}
          panelRect={panel.rect}
          width={width}
          height={height}
          frame={frame}
          selectedId={selectedBubble}
          clipId={clipId}
          onBlack={panel.fill === 'black' || (panel.frame === 'none' && ground === '#000')}
        />
      ))}
      {/* 枠線を引かないコマは出力に枠線が出ないが、選んで動かせるよう作業用の点線で輪郭を見せる */}
      <polygon
        data-panel-frame={panel.frame ?? ''}
        points={points}
        fill="none"
        stroke="#000"
        strokeDasharray={frameDash(panel.frame, selected)}
        style={selected || !line ? { stroke: GUIDE } : undefined}
        data-selected={selected || undefined}
        strokeWidth={selected ? 2 : panel.frame === 'double' ? 3 : 1}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
      {/* 二重線は太い線の中央を白で抜く。選択中は選択色の 1 本にする */}
      {panel.frame === 'double' && !selected && (
        <polygon
          points={points}
          fill="none"
          stroke="#fff"
          strokeWidth={1}
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
})

/** コマの絵。解決か読み込みに失敗したら、エラーを添えたプレースホルダーに戻す */
function PanelArt({
  panel,
  rect,
  clipId,
  toneId,
  loaded,
}: {
  panel: Panel
  rect: Box
  clipId: string
  toneId: string | undefined
  loaded: Promise<AssetState>
}) {
  const asset = use(loaded)
  const [broken, setBroken] = useState(false)
  if ('error' in asset || broken)
    return (
      <g clipPath={`url(#${clipId})`} data-art-error="">
        <Placeholder panel={panel} rect={rect} error />
      </g>
    )
  return (
    <image
      href={asset.url}
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      preserveAspectRatio="xMidYMid slice"
      clipPath={`url(#${clipId})`}
      filter={toneId && `url(#${toneId})`}
      onError={() => setBroken(true)}
    />
  )
}

/** コマの上に重ねるスピナーと生成ボタン */
const PanelOverlay = memo(function PanelOverlay({
  panelId,
  panelRect,
  panelShape,
  width,
  height,
  generating,
  onGenerate,
}: {
  panelId: ID
  panelRect: Rect
  panelShape: Point[] | undefined
  width: number
  height: number
  generating: boolean
  onGenerate?(panelId: ID): void
}) {
  const rect = panelBox({ rect: panelRect }, width, height)
  const outline = panelPolygon({ rect: panelRect, shape: panelShape }, width, height)
  const points = polygonPoints(outline)
  return (
    <g className="ec-overlay" data-overlay-panel-id={panelId}>
      {/* フキダシの上でも .ec-overlay:hover を効かせるための当たり判定 */}
      <polygon points={points} fill="transparent" />
      {generating && (
        <GeneratingOverlay rect={rect} points={points} label={m.editor_canvas_panel_generating()} />
      )}
      {onGenerate && !generating && (
        <GenerateButton outline={outline} onClick={() => onGenerate(panelId)} />
      )}
    </g>
  )
})

/**
 * ページ全体にアスペクト比を保って中央に収めた参考画像。コマは塗らないので、未生成のコマ越しに見える
 */
function ReferenceView({
  reference,
  resolveAsset,
  width,
  height,
}: {
  reference: ReferenceImage
  resolveAsset(ref: string): Promise<string>
  width: number
  height: number
}) {
  return (
    <g data-layer="reference">
      <Suspense>
        <ReferenceArt
          key={reference.ref}
          reference={reference}
          loaded={loadAsset(resolveAsset, reference.ref)}
          width={width}
          height={height}
        />
      </Suspense>
    </g>
  )
}

function ReferenceArt({
  reference,
  loaded,
  width,
  height,
}: {
  reference: ReferenceImage
  loaded: Promise<AssetState>
  width: number
  height: number
}) {
  const asset = use(loaded)
  const [broken, setBroken] = useState(false)
  if ('error' in asset || broken) return null
  return (
    <image
      href={asset.url}
      x={0}
      y={0}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      opacity={reference.opacity}
      visibility={reference.visible ? 'visible' : 'hidden'}
      pointerEvents="none"
      onError={() => setBroken(true)}
    />
  )
}

/**
 * 未生成コマの中身。「間」の印、camera と note を灰色の横書きで、コマに収まるぶんだけ出す。
 * シーンの見出しを持つコマでは、見出しの下から書く
 */
function Placeholder({ panel, rect, error }: { panel: Panel; rect: Box; error: boolean }) {
  if (!panel.beat && !panel.camera && !panel.note && !error) return null
  const top = sceneHeading(panel) === undefined ? NOTE_PAD : NOTE_PAD * 2 + NOTE_FONT
  return (
    <foreignObject x={rect.x} y={rect.y} width={rect.w} height={rect.h} data-placeholder="">
      <div
        style={{
          boxSizing: 'border-box',
          height: '100%',
          overflow: 'hidden',
          padding: `${top}px ${NUMBER_RADIUS * 2 + 2}px ${NOTE_PAD}px ${NOTE_PAD}px`,
          color: NOTE_COLOR,
          fontFamily: FONT_FAMILY,
          fontSize: `${NOTE_FONT}px`,
          lineHeight: 1.4,
          overflowWrap: 'anywhere',
        }}
      >
        {error && (
          <div style={{ color: 'var(--alert)' }}>{m.editor_canvas_panel_image_load_failed()}</div>
        )}
        {panel.beat && <div data-beat="">{m.panel_beat_mark()}</div>}
        {panel.camera && <div>[{m[`panel_camera_${panel.camera}` as const]()}]</div>}
        {panel.note && <div>{panel.note}</div>}
      </div>
    </foreignObject>
  )
}

/**
 * シーンの見出し。出力に出ない作業用の印で、右綴じは左上、左綴じはコマ番号の左に出す。
 * 絵の上でも読めるよう白で縁取る
 */
function SceneLabel({
  heading,
  outline,
  direction,
}: {
  heading: string
  outline: readonly PagePoint[]
  direction: ReadingDirection
}) {
  const { x, y } =
    direction === 'rtl'
      ? cornerAnchor(outline, 'nw', NOTE_PAD, NOTE_PAD)
      : cornerAnchor(outline, 'ne', -(NUMBER_RADIUS * 2 + 1 + NOTE_PAD), NOTE_PAD)
  return (
    <text
      x={x}
      y={y}
      style={{ fill: GUIDE }}
      stroke="#fff"
      strokeWidth={NOTE_FONT * 0.25}
      strokeLinejoin="round"
      paintOrder="stroke"
      fontFamily={FONT_FAMILY}
      fontSize={NOTE_FONT}
      fontWeight="bold"
      textAnchor={direction === 'rtl' ? 'start' : 'end'}
      dominantBaseline="hanging"
      data-scene-label={heading}
    >
      {m.panel_scene_heading({ scene: heading })}
    </text>
  )
}

/** 右上の丸の番号。出力のコマ番号とは別の、作業用の印。位置がロックされていれば下に鍵を添える */
function PanelNumber({
  order,
  outline,
  locked,
}: {
  order: number
  outline: readonly PagePoint[]
  locked: boolean
}) {
  const r = NUMBER_RADIUS
  const { x: cx, y: cy } = cornerAnchor(outline, 'ne', -(r + 1), r + 1)
  return (
    <g data-panel-number={order}>
      <circle cx={cx} cy={cy} r={r} style={{ fill: GUIDE }} />
      <text
        x={cx}
        y={cy}
        style={{ fill: 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={r * 1.1}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {order}
      </text>
      {locked && <LockMark x={cx} y={cy + r + 0.6} size={r * 1.2} />}
    </g>
  )
}

/** 位置がロックされた要素の番号の下に出す、出力に出ない鍵の印。(x, y) は上辺の中央 */
function LockMark({ x, y, size }: { x: number; y: number; size: number }) {
  const w = size * 0.8
  const bodyH = size * 0.55
  const bodyY = y + size - bodyH
  const shackle = w * 0.3
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: biome が <g> を対話要素と誤判定する。鍵の印は操作できず、名前だけを伝える
    <g role="img" aria-label={m.editor_canvas_locked()} data-locked="">
      <title>{m.editor_canvas_locked()}</title>
      <path
        d={`M ${x - shackle} ${bodyY} V ${y + shackle} A ${shackle} ${shackle} 0 0 1 ${x + shackle} ${y + shackle} V ${bodyY}`}
        fill="none"
        style={{ stroke: GUIDE }}
        strokeWidth={size * 0.14}
      />
      <rect
        x={x - w / 2}
        y={bodyY}
        width={w}
        height={bodyH}
        rx={size * 0.08}
        style={{ fill: GUIDE }}
      />
    </g>
  )
}

/** 半透明の白と回るスピナー */
function GeneratingOverlay({ rect, points, label }: { rect: Box; points: string; label: string }) {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const r = Math.min(12, Math.max(3, Math.min(rect.w, rect.h) * 0.12))
  return (
    <g data-spinner="" aria-label={label}>
      <polygon points={points} fill="#fff" opacity={0.6} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        style={{ stroke: 'var(--guide-soft)' }}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        style={{ stroke: GUIDE }}
        strokeWidth={3}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  )
}

/** コマのホバーで出す「生成」ボタン。右下に置く */
function GenerateButton({ outline, onClick }: { outline: readonly PagePoint[]; onClick(): void }) {
  const w = 12
  const h = 5
  const center = cornerAnchor(outline, 'se', -(w / 2 + 1.5), -(h / 2 + 1.5))
  const x = center.x - w / 2
  const y = center.y - h / 2
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG の中に <button> は置けない
    <g
      className="ec-generate"
      role="button"
      tabIndex={0}
      aria-label={m.editor_canvas_panel_generate_aria()}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onClick()
      }}
    >
      <rect x={x} y={y} width={w} height={h} rx={1} style={{ fill: GUIDE }} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        style={{ fill: 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={2.6}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {m.generate()}
      </text>
    </g>
  )
}

/** 1 つのフキダシの輪郭の描き方。shapes はしっぽ、本体、首の path */
interface OutlineItem {
  shapes: string[]
  paper: string
  line: BubblePaths['line']
  fill: boolean
  ink: string | null
}

/** フキダシの path と地の色から輪郭の描き方を作る。neck は首の path で、無ければ null */
function outlineItem(paths: BubblePaths, fill: Bubble['fill'], neck: string | null): OutlineItem {
  return {
    shapes: [...paths.tails, paths.body, ...(neck === null ? [] : [neck])],
    paper: paths.fill && fill === 'black' ? '#000' : '#fff',
    line: paths.line,
    fill: paths.fill,
    ink: paths.ink,
  }
}

/**
 * フキダシの輪郭。全部の線を太線で引いてから同じ形を地の色で塗り重ね、本体、しっぽ、首の継ぎ目の線を消す。
 * items を並べると、どのフキダシの塗りも他のフキダシの継ぎ目の線を消し、1 つの輪郭に見せる
 */
function BubbleOutlines({ items }: { items: readonly OutlineItem[] }) {
  return (
    <>
      {items.flatMap((item, i) =>
        item.line === 'none'
          ? []
          : item.shapes.map((d, j) => (
              <path
                // biome-ignore lint/suspicious/noArrayIndexKey: 先端の重なったしっぽは同じ d になるので、位置で見分ける
                key={`stroke-${i}-${j}`}
                d={d}
                fill={item.paper}
                stroke="#000"
                strokeWidth={BUBBLE_STROKE}
                strokeDasharray={
                  item.line === 'dashed'
                    ? BUBBLE_DASH.map((n) => n * BUBBLE_STROKE).join(' ')
                    : undefined
                }
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )),
      )}
      {items.flatMap((item, i) =>
        item.fill
          ? item.shapes.map((d, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 先端の重なったしっぽは同じ d になるので、位置で見分ける
              <path key={`fill-${i}-${j}`} d={d} fill={item.paper} />
            ))
          : [],
      )}
      {items.map(
        (item, i) =>
          item.ink !== null && (
            // biome-ignore lint/suspicious/noArrayIndexKey: 組の中の並びは order 順で変わらない
            <path key={`ink-${i}`} d={item.ink} fill="#000" />
          ),
      )}
    </>
  )
}

/**
 * bubbleGroups の 1 組のフキダシ。1 つだけなら BubbleView のまま描き、つないだ組は輪郭をまとめて
 * 1 つに描いてから、フキダシごとのセリフと印を重ねる
 */
function BubbleGroupView({
  group,
  selectedId,
  ...rest
}: {
  group: readonly Bubble[]
  selectedId: ID | undefined
  panelRect: Rect
  width: number
  height: number
  frame: Rect
  clipId?: string
  onBlack?: boolean
}) {
  const [first] = group
  if (!first) return null
  if (group.length === 1) {
    return <BubbleView bubble={first} selected={first.id === selectedId} {...rest} />
  }
  const panel = panelBox({ rect: rest.panelRect }, rest.width, rest.height)
  const geometries = new Map(group.map((b) => [b.id, bubbleGeometry(b, panel)]))
  const items = group.map((b) => {
    const g = geometries.get(b.id) as BubbleGeometry
    const to =
      b.joinedTo !== undefined && b.joinedTo !== b.id ? geometries.get(b.joinedTo) : undefined
    return outlineItem(bubblePaths(b.shape, g), b.fill, to ? neckPath(g, to) : null)
  })
  return (
    <g data-bubble-group={group.map((b) => b.id).join(' ')}>
      <g clipPath={rest.clipId && `url(#${rest.clipId})`}>
        <BubbleOutlines items={items} />
      </g>
      {group.map((b) => (
        <BubbleView
          key={b.id}
          bubble={b}
          selected={b.id === selectedId}
          outlined={false}
          {...rest}
        />
      ))}
    </g>
  )
}

/**
 * フキダシ。太線で輪郭を描いてから同じ形を地の色（黒フキダシは黒、他は白）で塗り重ね、本体としっぽの継ぎ目の線を消す。
 * 黒フキダシのセリフは白で描く。
 * 外側に残る線は太線の半分になる。枠なしは何も描かない代わりに、選択していなくても薄い破線で範囲を示す。
 * clipId を渡すと、輪郭と文字をその clipPath で切る。フキダシは内枠の外に出てよいが、セリフは断裁で
 * 切れないよう内枠の内側に寄せる
 */
const BubbleView = memo(function BubbleView({
  bubble,
  panelRect,
  width,
  height,
  frame,
  selected,
  clipId,
  onBlack = false,
  outlined = true,
}: {
  bubble: Bubble
  panelRect: Rect
  width: number
  height: number
  /** ページの内枠（innerFrameOf）。セリフはこの外に出さない */
  frame: Rect
  selected: boolean
  clipId?: string
  /** 黒塗りのコマの中。白い地を持たないフキダシのセリフを白で描く */
  onBlack?: boolean
  /** 輪郭を描くか。連結フキダシは BubbleGroupView が組の輪郭をまとめて描くので false にする */
  outlined?: boolean
}) {
  const panel = panelBox({ rect: panelRect }, width, height)
  const g = bubbleGeometry(bubble, panel)
  const paths = bubblePaths(bubble.shape, g)
  const text = bubbleTextBox(bubble.shape, g)
  const box = clipTextBox(
    clipId ? clipTextBox(text, panel) : text,
    panelBox({ rect: frame }, width, height),
  )
  const layout = layoutVertical(bubble.text, box)
  const black = paths.fill && bubble.fill === 'black'
  const ink = black || (onBlack && !paths.fill) ? '#fff' : '#000'
  const typeface = bubbleTypeface(bubble)
  const illegible =
    layout.columns.length > 0 && (layout.truncated || layout.fontSize < LEGIBLE_FONT)
  return (
    <g
      className="ec-bubble"
      data-bubble-id={bubble.id}
      data-shape={bubble.shape}
      data-typeface={typeface}
      data-bubble-fill={black ? 'black' : undefined}
      data-joined-to={bubble.joinedTo}
    >
      <g clipPath={clipId && `url(#${clipId})`}>
        {outlined && <BubbleOutlines items={[outlineItem(paths, bubble.fill, null)]} />}
        <VerticalText
          layout={layout}
          cx={box.x + box.w / 2}
          cy={box.y + box.h / 2}
          typeface={typeface}
          fill={ink}
        />
      </g>
      {selected ? (
        <path
          d={paths.body}
          fill="none"
          style={{ stroke: GUIDE }}
          strokeWidth={2}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        !paths.fill && (
          <path
            d={paths.body}
            fill="none"
            style={{ stroke: GUIDE }}
            strokeWidth={1}
            strokeDasharray="2 2"
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
            data-bubble-guide
          />
        )
      )}
      <text
        x={g.cx + g.rx}
        y={g.cy - g.ry}
        style={{ fill: GUIDE }}
        fontFamily={FONT_FAMILY}
        fontSize={2.2}
        textAnchor="middle"
        data-bubble-order={bubble.order}
      >
        {bubble.order}
      </text>
      {bubble.locked && <LockMark x={g.cx + g.rx} y={g.cy - g.ry + 0.6} size={2.2} />}
      {illegible && <IllegibleAlert x={g.cx - g.rx} y={g.cy - g.ry} truncated={layout.truncated} />}
    </g>
  )
})

/**
 * 組んだ縦書きを、中心 (cx, cy) に右の列から左へ置く。ルビは親文字の右に置く。
 * halo を渡すと、その色と太さ（mm）のふちを字の下に敷く
 */
function VerticalText({
  layout,
  cx,
  cy,
  typeface,
  fill,
  halo,
}: {
  layout: VerticalLayout
  cx: number
  cy: number
  typeface: NonNullable<Bubble['typeface']>
  fill: string
  halo?: { color: string; width: number }
}) {
  if (layout.columns.length === 0) return null
  const right = cx + layout.width / 2
  const fs = layout.fontSize
  const rubySize = fs * RUBY_SCALE
  const font = TYPEFACES[typeface]
  const paint = {
    writingMode: 'vertical-rl',
    fontFamily: font.family,
    fontWeight: font.weight,
    textAnchor: 'middle' as const,
    fill,
    ...(halo && {
      stroke: halo.color,
      strokeWidth: halo.width,
      strokeLinejoin: 'round' as const,
      paintOrder: 'stroke',
    }),
  }
  return (
    <>
      <text {...paint} fontSize={fs} data-truncated={layout.truncated || undefined}>
        {layout.columns.map((column, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 列は位置で決まり、同じ文字列の列も並びうる
          <tspan key={i} x={right - column.offset} y={cy}>
            {column.text}
          </tspan>
        ))}
      </text>
      {layout.columns.flatMap((column, i) => {
        // 列は中央揃えで、字は 1 字が文字サイズ 1 つぶんの高さとみなす
        const top = cy - (column.length * fs) / 2
        return column.rubies.map((ruby) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: ルビは列と列の中の位置で決まる
            key={`${i}-${ruby.start}`}
            {...paint}
            fontSize={rubySize}
            x={right - column.offset + (fs + rubySize) / 2}
            y={top + (ruby.start + ruby.length / 2) * fs}
            data-ruby
          >
            {ruby.text}
          </text>
        ))
      })}
      {layout.columns.flatMap((column, i) => {
        const top = cy - (column.length * fs) / 2
        const rows = column.emphases.flatMap(({ start, length }) =>
          Array.from({ length }, (_, k) => start + k),
        )
        return rows.map((row) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: 傍点は列と列の中の位置で決まる
            key={`${i}-${row}`}
            {...paint}
            fontSize={rubySize}
            x={right - column.offset + (fs + rubySize) / 2}
            y={top + (row + 0.5) * fs}
            data-emphasis
          >
            {EMPHASIS_MARK}
          </text>
        ))
      })}
    </>
  )
}

/** sfx の焦点の描き文字。焦点の位置を中心に、太ゴシックの縦書きの黒い字に白いふちを付けて置く */
function SfxView({ focus, panel }: { focus: FocusPoint; panel: Box }) {
  const fontSize = sfxFontSize(focus.weight, panel.w, panel.h)
  return (
    <g data-sfx-id={focus.id} pointerEvents="none">
      <VerticalText
        layout={layoutUnbroken(focus.label, fontSize)}
        cx={panel.x + focus.pos.x * panel.w}
        cy={panel.y + focus.pos.y * panel.h}
        typeface={SFX_TYPEFACE}
        fill="#000"
        halo={{ color: '#fff', width: fontSize * SFX_OUTLINE }}
      />
    </g>
  )
}

/** 文字が小さすぎるか収まらないフキダシの左上に出す、出力に出ない警告の印 */
function IllegibleAlert({ x, y, truncated }: { x: number; y: number; truncated: boolean }) {
  const message = truncated
    ? m.editor_canvas_bubble_text_truncated()
    : m.editor_canvas_bubble_text_too_small()
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: biome が <g> を対話要素と誤判定する。警告の印は操作できず、名前だけを伝える
    <g role="img" aria-label={message} data-bubble-alert={truncated ? 'truncated' : 'small'}>
      <title>{message}</title>
      <circle cx={x} cy={y} r={ALERT_RADIUS} style={{ fill: 'var(--alert)' }} />
      <text
        x={x}
        y={y}
        style={{ fill: 'var(--on-alert)' }}
        fontFamily={FONT_FAMILY}
        fontSize={ALERT_RADIUS * 1.4}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
      >
        !
      </text>
    </g>
  )
}
