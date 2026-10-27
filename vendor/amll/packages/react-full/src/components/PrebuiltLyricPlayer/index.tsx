/**
 * @fileoverview
 * 已经部署好所有组件的歌词播放器组件，在正确设置所有的 Jotai 状态后可以开箱即用
 */

import {
	type BaseRenderer,
	IsolationRenderer,
	type OptimizeLyricOptions,
} from "@applemusic-like-lyrics/core";
import {
	BackgroundRender,
	LyricPlayer,
	type LyricPlayerRef,
} from "@applemusic-like-lyrics/react";
import structuredClone from "@ungap/structured-clone";
import classNames from "classnames";
import { AnimatePresence, LayoutGroup } from "framer-motion";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
	type FC,
	type HTMLProps,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AutoLyricLayout } from "../../layout/auto";
import { toDuration } from "../../utils";
import { AudioFFTVisualizer } from "../AudioFFTVisualizer";
import { AudioQualityTag } from "../AudioQualityTag";
import { BouncingSlider } from "../BouncingSlider";
import { ControlThumb } from "../ControlThumb";
import { Cover } from "../Cover";
import { MediaButton } from "../MediaButton";
import { MusicInfo } from "../MusicInfo";
import { PrebuiltToggleIconButton } from "../ToggleIconButton";
import { PrebuiltToggleIconButtonType } from "../ToggleIconButton/prebuilt-enum";

import { VolumeControl } from "../VolumeControlSlider";

import IconForward from "./icon_forward.svg?react";
import IconPause from "./icon_pause.svg?react";
import IconPlay from "./icon_play.svg?react";
import IconRewind from "./icon_rewind.svg?react";
import RepeatIcon from "./repeat.svg?react";
import RepeatActiveIcon from "./repeat-active.svg?react";
import RepeatOneActiveIcon from "./repeat-one-active.svg?react";
import ShuffleIcon from "./shuffle.svg?react";
import ShuffleActiveIcon from "./shuffle-active.svg?react";

import "./icon-animations.css";
import React from "react";
import {
	onChangeVolumeAtom,
	onClickAudioQualityTagAtom,
	onClickControlThumbAtom,
	onLyricLineClickAtom,
	onLyricLineContextMenuAtom,
	onPlayOrResumeAtom,
	onRequestNextSongAtom,
	onRequestOpenMenuAtom,
	onRequestPrevSongAtom,
	onSeekPositionAtom,
} from "../../states/callbacks";
import {
	CSS_BACKGROUND_RENDERER_ID,
	cssBackgroundPropertyAtom,
	DEFAULT_BACKGROUND_RENDERER_ID,
	enableLyricLineBlurEffectAtom,
	enableLyricLineScaleEffectAtom,
	enableLyricLineSpringAnimationAtom,
	enableLyricRomanLineAtom,
	enableLyricSwapTransRomanLineAtom,
	enableLyricTranslationLineAtom,
	hideLyricViewAtom,
	isLyricPageOpenedAtom,
	isolationRendererOptionsAtom,
	LyricSizePreset,
	lyricBackgroundFPSAtom,
	lyricBackgroundRendererAtom,
	lyricBackgroundRenderScaleAtom,
	lyricBackgroundStaticModeAtom,
	lyricFontFamilyAtom,
	lyricFontWeightAtom,
	lyricLetterSpacingAtom,
	lyricPlayerImplementationAtom,
	lyricSizePresetAtom,
	lyricWordFadeWidthAtom,
	PlayerControlsType,
	playerControlsTypeAtom,
	resolveBackgroundRenderer,
	showBottomControlAtom,
	showMusicAlbumAtom,
	showMusicArtistsAtom,
	showMusicNameAtom,
	showRemainingTimeAtom,
	showVolumeControlAtom,
	VerticalCoverLayout,
	verticalCoverLayoutAtom,
} from "../../states/configAtoms";
import {
	cycleRepeatModeActionAtom,
	isShuffleActiveAtom,
	isShuffleEnabledAtom,
	isRepeatEnabledAtom,
	RepeatMode,
	repeatModeAtom,
	toggleShuffleActionAtom,
} from "../../states/controlsAtoms";
import {
	fftDataAtom,
	lowFreqVolumeAtom,
	musicAlbumNameAtom,
	musicArtistsAtom,
	musicCoverAtom,
	musicCoverIsVideoAtom,
	musicDurationAtom,
	musicLyricLinesAtom,
	musicNameAtom,
	musicPlayingAtom,
	musicPlayingPositionAtom,
	musicQualityTagAtom,
	musicVolumeAtom,
} from "../../states/dataAtoms";
import styles from "./index.module.css";

const PrebuiltMusicInfo: FC<{
	className?: string;
	style?: React.CSSProperties;
	favoriteButtonSlot?: React.ReactNode;
}> = ({ className, style, favoriteButtonSlot }) => {
	const musicName = useAtomValue(musicNameAtom);
	const musicArtists = useAtomValue(musicArtistsAtom);
	const musicAlbum = useAtomValue(musicAlbumNameAtom);
	const onMenuClicked = useAtomValue(onRequestOpenMenuAtom).onEmit;
	const showMusicName = useAtomValue(showMusicNameAtom);
	const showMusicArtists = useAtomValue(showMusicArtistsAtom);
	const showMusicAlbum = useAtomValue(showMusicAlbumAtom);
	const fontFamily = useAtomValue(lyricFontFamilyAtom);
	const fontWeight = useAtomValue(lyricFontWeightAtom);
	const letterSpacing = useAtomValue(lyricLetterSpacingAtom);
	const combinedStyle = useMemo(
		() => ({
			...style,
			fontFamily: fontFamily || undefined,
			fontWeight: fontWeight || undefined,
			letterSpacing: letterSpacing || undefined,
		}),
		[style, fontFamily, fontWeight, letterSpacing],
	);

	return (
		<MusicInfo
			className={className}
			style={combinedStyle}
			name={showMusicName ? musicName : undefined}
			artists={showMusicArtists ? musicArtists.map((v) => v.name) : undefined}
			album={showMusicAlbum ? musicAlbum : undefined}
			onMenuButtonClicked={onMenuClicked}
			favoriteButtonSlot={favoriteButtonSlot}
		/>
	);
};

const PrebuiltMediaButtons: FC<{
	showOtherButtons?: boolean;
}> = ({ showOtherButtons }) => {
	const musicIsPlaying = useAtomValue(musicPlayingAtom);
	const onRequestPrevSong = useAtomValue(onRequestPrevSongAtom).onEmit;
	const onRequestNextSong = useAtomValue(onRequestNextSongAtom).onEmit;
	const onPlayOrResume = useAtomValue(onPlayOrResumeAtom).onEmit;

	const isShuffleOn = useAtomValue(isShuffleActiveAtom);
	const isShuffleEnabled = useAtomValue(isShuffleEnabledAtom);
	const isRepeatEnabled = useAtomValue(isRepeatEnabledAtom);
	const currentRepeatMode = useAtomValue(repeatModeAtom);

	const toggleShuffle = useSetAtom(toggleShuffleActionAtom);
	const cycleRepeat = useSetAtom(cycleRepeatModeActionAtom);

	const iconStyle = {
		width: "1.3em",
		height: "1.3em",
	};

	const renderRepeatIcon = () => {
		switch (currentRepeatMode) {
			case RepeatMode.One:
				return <RepeatOneActiveIcon color="#ffffffff" style={iconStyle} />;
			case RepeatMode.All:
				return <RepeatActiveIcon color="#ffffffff" style={iconStyle} />;
			default:
				return <RepeatIcon color="#ffffffff" style={iconStyle} />;
		}
	};

	return (
		<>
			{showOtherButtons && (
					<MediaButton className={styles.songMediaButton} onClick={toggleShuffle} disabled={!isShuffleEnabled} aria-label="Shuffle" aria-pressed={isShuffleOn}>
					{isShuffleOn ? (
						<ShuffleActiveIcon color="#ffffffff" style={iconStyle} />
					) : (
						<ShuffleIcon color="#ffffffff" style={iconStyle} />
					)}
				</MediaButton>
			)}
			<MediaButton
				className={styles.songMediaButton}
				onClick={onRequestPrevSong}
				aria-label="Previous track"
			>
				<IconRewind color="#FFFFFF" />
			</MediaButton>
			<MediaButton
				className={styles.songMediaPlayButton}
				onClick={onPlayOrResume}
				aria-label={musicIsPlaying ? "Pause" : "Play"}
			>
				{musicIsPlaying ? (
					<IconPause color="#FFFFFF" />
				) : (
					<IconPlay color="#FFFFFF" />
				)}
			</MediaButton>
			<MediaButton
				className={styles.songMediaButton}
				onClick={onRequestNextSong}
				aria-label="Next track"
			>
				<IconForward color="#FFFFFF" />
			</MediaButton>

			{showOtherButtons && (
					<MediaButton className={styles.songMediaButton} onClick={cycleRepeat} disabled={!isRepeatEnabled} aria-label={`Repeat: ${currentRepeatMode}`}>
					{renderRepeatIcon()}
				</MediaButton>
			)}
		</>
	);
};

const TimeLabel: FC<{ isRemaining?: boolean }> = React.memo(({ isRemaining }) => {
	// Subscribe to the formatted label, so identical text does not re-render every frame.
	const labelAtom = useMemo(() => atom((get) => toDuration(
		isRemaining
			? (get(musicPlayingPositionAtom) - get(musicDurationAtom)) / 1000
			: get(musicPlayingPositionAtom) / 1000,
	)), [isRemaining]);
	const time = useAtomValue(labelAtom);
	return <>{time}</>;
});

const TotalDurationLabel: FC = () => {
	const duration = useAtomValue(musicDurationAtom);
	const time = useMemo(() => toDuration(duration / 1000), [duration]);
	return <>{time}</>;
};

const manualSeekTriggerAtom = atom<{ time: number; timestamp: number } | null>(
	null,
);

const PrebuiltProgressBar: FC = React.memo(() => {
	const musicDuration = useAtomValue(musicDurationAtom);
	const musicPosition = useAtomValue(musicPlayingPositionAtom);
	const musicIsPlaying = useAtomValue(musicPlayingAtom);
	const musicQualityTag = useAtomValue(musicQualityTagAtom);
	const onClickAudioQualityTag = useAtomValue(
		onClickAudioQualityTagAtom,
	).onEmit;
	const onSeekPosition = useAtomValue(onSeekPositionAtom).onEmit;
	const setManualSeekTrigger = useSetAtom(manualSeekTriggerAtom);

	const [showRemaining, setShowRemaining] = useAtom(showRemainingTimeAtom);

	const fontFamily = useAtomValue(lyricFontFamilyAtom);
	const fontWeight = useAtomValue(lyricFontWeightAtom);
	const letterSpacing = useAtomValue(lyricLetterSpacingAtom);

	const fontStyle = useMemo(
		() => ({
			fontFamily: fontFamily || undefined,
			fontWeight: fontWeight || undefined,
			letterSpacing: letterSpacing || undefined,
		}),
		[fontFamily, fontWeight, letterSpacing],
	);

	const handleSeek = useCallback((position: number) => {
		onSeekPosition?.(position);
		setManualSeekTrigger({ time: position, timestamp: Date.now() });
	}, [onSeekPosition, setManualSeekTrigger]);

	return (
		<div>
			<BouncingSlider
				isPlaying={musicIsPlaying}
				min={0}
				max={musicDuration}
				value={musicPosition}
				onChange={handleSeek}
			/>
			<div className={styles.progressBarLabels}>
				<div style={fontStyle}>
					<TimeLabel />
				</div>
				<div>
					<AnimatePresence mode="popLayout">
						{musicQualityTag && (
							<AudioQualityTag
								className={styles.qualityTag}
								isDolbyAtmos={musicQualityTag.isDolbyAtmos}
								tagText={musicQualityTag.tagText}
								tagIcon={musicQualityTag.tagIcon}
								onClick={onClickAudioQualityTag}
							/>
						)}
					</AnimatePresence>
				</div>
				<div
					style={{ ...fontStyle, cursor: "pointer", userSelect: "none" }}
					onClick={() => setShowRemaining(!showRemaining)}
				>
					{showRemaining ? <TimeLabel isRemaining /> : <TotalDurationLabel />}
				</div>
			</div>
		</div>
	);
});

function getLyricFontSizeFromPreset(preset: LyricSizePreset): string {
	switch (preset) {
		case LyricSizePreset.Tiny:
			return "max(max(2.5vh, 1.25vw), 10px)";
		case LyricSizePreset.ExtraSmall:
			return "max(max(3vh, 1.5vw), 10px)";
		case LyricSizePreset.Small:
			return "max(max(4vh, 2vw), 12px)";
		case LyricSizePreset.Large:
			return "max(max(6vh, 3vw), 16px)";
		case LyricSizePreset.ExtraLarge:
			return "max(max(7vh, 3.5vw), 18px)";
		case LyricSizePreset.Huge:
			return "max(max(8vh, 4vw), 20px)";
		default:
			return "max(max(5vh, 2.5vw), 14px)";
	}
}

const PrebuiltCoreLyricPlayer: FC<{
	alignPosition: number;
	alignAnchor: "center" | "bottom" | "top";
	bottomLine?: React.ReactNode;
	optimizeOptions?: OptimizeLyricOptions;
	lyricTimeOffsetMs?: number;
}> = ({ alignPosition, alignAnchor, bottomLine, optimizeOptions, lyricTimeOffsetMs = 0 }) => {
	const amllPlayerRef = useRef<LyricPlayerRef>(null);
	const musicIsPlaying = useAtomValue(musicPlayingAtom);
	const lyricLines = useAtomValue(musicLyricLinesAtom);
	const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
	const store = useStore();
	const musicPlayingPosition = store.get(musicPlayingPositionAtom);

	// Drive AMLL directly at the incoming media frame cadence. Subscribing through
	// useAtomValue here would re-render the entire lyric component for every frame.
	useLayoutEffect(() => {
		const syncTime = () => {
			amllPlayerRef.current?.lyricPlayer?.setCurrentTime(
				Math.max(0, Math.round(store.get(musicPlayingPositionAtom) - lyricTimeOffsetMs)),
			);
		};
		syncTime();
		return store.sub(musicPlayingPositionAtom, syncTime);
	}, [store, lyricTimeOffsetMs]);

	const lyricFontFamily = useAtomValue(lyricFontFamilyAtom);
	const lyricFontWeight = useAtomValue(lyricFontWeightAtom);
	const lyricLetterSpacing = useAtomValue(lyricLetterSpacingAtom);
	const lyricSizePreset = useAtomValue(lyricSizePresetAtom);

	const lyricPlayerImplementation = useAtomValue(
		lyricPlayerImplementationAtom,
	).lyricPlayer;

	const enableLyricLineBlurEffect = useAtomValue(enableLyricLineBlurEffectAtom);
	const enableLyricLineScaleEffect = useAtomValue(
		enableLyricLineScaleEffectAtom,
	);
	const enableLyricLineSpringAnimation = useAtomValue(
		enableLyricLineSpringAnimationAtom,
	);
	const lyricWordFadeWidth = useAtomValue(lyricWordFadeWidthAtom);
	const enableLyricTranslationLine = useAtomValue(
		enableLyricTranslationLineAtom,
	);
	const enableLyricRomanLine = useAtomValue(enableLyricRomanLineAtom);
	const enableLyricSwapTransRomanLine = useAtomValue(
		enableLyricSwapTransRomanLineAtom,
	);
	const onLyricLineClick = useAtomValue(onLyricLineClickAtom).onEmit;
	const onLyricLineContextMenu = useAtomValue(
		onLyricLineContextMenuAtom,
	).onEmit;
	const manualSeekTrigger = useAtomValue(manualSeekTriggerAtom);

	const processedLyricLines = useMemo(() => {
		const processed = structuredClone(lyricLines);
		if (!enableLyricTranslationLine) {
			for (const line of processed) {
				line.translatedLyric = "";
			}
		}
		if (!enableLyricRomanLine) {
			for (const line of processed) {
				line.romanLyric = "";
			}
		}
		if (enableLyricSwapTransRomanLine) {
			for (const line of processed) {
				[line.translatedLyric, line.romanLyric] = [
					line.romanLyric,
					line.translatedLyric,
				];
			}
		}
		return processed;
	}, [
		lyricLines,
		enableLyricTranslationLine,
		enableLyricRomanLine,
		enableLyricSwapTransRomanLine,
	]);

	useEffect(() => {
		if (manualSeekTrigger) {
			amllPlayerRef.current?.lyricPlayer?.setCurrentTime(
				Math.max(0, manualSeekTrigger.time - lyricTimeOffsetMs),
				true,
			);
		}
	}, [manualSeekTrigger, lyricTimeOffsetMs]);

	const handleLineClick = useCallback((evt: Parameters<NonNullable<React.ComponentProps<typeof LyricPlayer>["onLyricLineClick"]>>[0]) => {
		const targetTime = evt.line.getLine().startTime;
		amllPlayerRef.current?.lyricPlayer?.setCurrentTime(targetTime, true);
		onLyricLineClick?.(evt, amllPlayerRef.current);
	}, [onLyricLineClick]);
	const handleLineContextMenu = useCallback((evt: Parameters<NonNullable<React.ComponentProps<typeof LyricPlayer>["onLyricLineContextMenu"]>>[0]) => {
		onLyricLineContextMenu?.(evt, amllPlayerRef.current);
	}, [onLyricLineContextMenu]);

	return (
		<LyricPlayer
			style={
				{
					width: "100%",
					height: "100%",
					fontFamily: lyricFontFamily || undefined,
					fontWeight: lyricFontWeight || undefined,
					letterSpacing: lyricLetterSpacing || undefined,
					"--amll-lp-font-size": getLyricFontSizeFromPreset(lyricSizePreset),
				} as React.CSSProperties
			}
			ref={amllPlayerRef}
			playing={musicIsPlaying}
			disabled={!isLyricPageOpened}
			alignPosition={alignPosition}
			alignAnchor={alignAnchor}
			currentTime={Math.max(0, Math.round(musicPlayingPosition - lyricTimeOffsetMs))}
			lyricLines={processedLyricLines}
			optimizeOptions={optimizeOptions}
			enableBlur={enableLyricLineBlurEffect}
			enableScale={enableLyricLineScaleEffect}
			enableSpring={enableLyricLineSpringAnimation}
			wordFadeWidth={lyricWordFadeWidth}
			lyricPlayer={lyricPlayerImplementation}
			onLyricLineClick={handleLineClick}
			onLyricLineContextMenu={handleLineContextMenu}
			bottomLine={bottomLine}
		/>
	);
};

const PrebuiltVolumeControl: FC<{
	style?: React.CSSProperties;
	className?: string;
}> = ({ style, className }) => {
	const musicVolume = useAtomValue(musicVolumeAtom);
	const onChangeVolume = useAtomValue(onChangeVolumeAtom).onEmit;
	const showVolumeControl = useAtomValue(showVolumeControlAtom);
	if (showVolumeControl)
		return (
			<VolumeControl
				value={musicVolume}
				min={0}
				max={1}
				style={style}
				className={className}
				onChange={onChangeVolume}
			/>
		);
	return null;
};

const PrebuiltMusicControls: FC<
	{
		showOtherButtons?: boolean;
	} & HTMLProps<HTMLDivElement>
> = ({ className, showOtherButtons, ...props }) => {
	const playerControlsType = useAtomValue(playerControlsTypeAtom);
	const fftData = useAtomValue(fftDataAtom);
	return (
		<div className={classNames(styles.controls, className)} {...props}>
			{playerControlsType === PlayerControlsType.Controls && (
				<PrebuiltMediaButtons showOtherButtons={showOtherButtons} />
			)}
			{playerControlsType === PlayerControlsType.FFT && (
				<AudioFFTVisualizer
					style={{
						width: "100%",
						height: "8vh",
					}}
					fftData={fftData}
				/>
			)}
		</div>
	);
};

export interface PrebuiltLyricPlayerProps extends HTMLProps<HTMLDivElement> {
	bottomLineSlot?: React.ReactNode;
	optimizeOptions?: OptimizeLyricOptions;
	onPlaylistClick?: () => void;
	onAirPlayClick?: () => void;
	fullscreenButtonSlot?: React.ReactNode;
	favoriteButtonSlot?: React.ReactNode;
	/** Lyrics-only timing correction; progress controls keep the actual media time. */
	lyricTimeOffsetMs?: number;
}

/**
 * 已经部署好所有组件的歌词播放器组件，在正确设置所有的 Jotai 状态后可以开箱即用
 */
export const PrebuiltLyricPlayer: FC<PrebuiltLyricPlayerProps> = ({
	className,
	bottomLineSlot,
	optimizeOptions,
	lyricTimeOffsetMs,
	onPlaylistClick,
	onAirPlayClick,
	fullscreenButtonSlot,
	favoriteButtonSlot,
	...rest
}) => {
	const [hideLyricView, setHideLyricView] = useAtom(hideLyricViewAtom);
	const musicCover = useAtomValue(musicCoverAtom);
	const musicCoverIsVideo = useAtomValue(musicCoverIsVideoAtom);
	const musicIsPlaying = useAtomValue(musicPlayingAtom);
	const lowFreqVolume = useAtomValue(lowFreqVolumeAtom);
	const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
	const lyricBackgroundFPS = useAtomValue(lyricBackgroundFPSAtom);
	const verticalCoverLayout = useAtomValue(verticalCoverLayoutAtom);
	const lyricBackgroundStaticMode = useAtomValue(lyricBackgroundStaticModeAtom);
	const lyricBackgroundRenderScale = useAtomValue(
		lyricBackgroundRenderScaleAtom,
	);
	const onClickControlThumb = useAtomValue(onClickControlThumbAtom).onEmit;
	const [isVertical, setIsVertical] = useState(false);
	const [alignPosition, setAlignPosition] = useState(0.25);
	const [alignAnchor, setAlignAnchor] = useState<"center" | "bottom" | "top">(
		"top",
	);
	const coverElRef = useRef<HTMLDivElement>(null);
	const [layoutEl, setLayoutEl] = useState<HTMLDivElement | null>(null);
	const backgroundRenderer = useAtomValue(lyricBackgroundRendererAtom);
	// 配置里存的可能是字符串标识，也可能是调用方直接塞进来的渲染器类。字符串一律
	// 过一遍支持性检查，解析成 css-bg 时说明当前环境没有能用的渲染器，改走下面的
	// CSS 背景分支
	const resolvedBackgroundRenderer = useMemo(() => {
		const configured = backgroundRenderer.renderer;
		if (typeof configured === "string") {
			return resolveBackgroundRenderer(configured);
		}
		return (
			configured ?? resolveBackgroundRenderer(DEFAULT_BACKGROUND_RENDERER_ID)
		);
	}, [backgroundRenderer.renderer]);
	const isolationRendererOptions = useAtomValue(isolationRendererOptionsAtom);
	const configureBackgroundRenderer = useCallback(
		(renderer: BaseRenderer) => {
			if (renderer instanceof IsolationRenderer) {
				renderer.setOptions(isolationRendererOptions);
			}
		},
		[isolationRendererOptions],
	);
	const showBottomControl = useAtomValue(showBottomControlAtom);

	const cssBackgroundProperty = useAtomValue(cssBackgroundPropertyAtom);

	useLayoutEffect(() => {
		// 如果是水平布局，则让歌词对齐到封面的中心
		if (!isVertical && coverElRef.current && layoutEl) {
			const obz = new ResizeObserver(() => {
				if (!(coverElRef.current && layoutEl)) return;
				const coverB = coverElRef.current.getBoundingClientRect();
				const layoutB = layoutEl.getBoundingClientRect();
				setAlignPosition(
					(coverB.top + coverB.height / 2 - layoutB.top) / layoutB.height,
				);
			});
			obz.observe(coverElRef.current);
			obz.observe(layoutEl);
			setAlignAnchor("center");
			return () => obz.disconnect();
		}
		// 如果是垂直布局，则把歌词对齐到顶部（歌曲信息下方）
		if (isVertical) {
			setAlignPosition(0.1);
			setAlignAnchor("top");
		}
		return;
	}, [isVertical, layoutEl]);

	const verticalImmerseCover =
		hideLyricView &&
		(verticalCoverLayout === VerticalCoverLayout.Auto
			? musicCoverIsVideo && isVertical
			: verticalCoverLayout === VerticalCoverLayout.ForceImmersive);
	const smallMusicInfo = (
		<PrebuiltMusicInfo
			className={classNames(
				styles.smallMusicInfo,
				hideLyricView && styles.hideLyric,
			)}
			favoriteButtonSlot={favoriteButtonSlot}
		/>
	);
	const showSmallFullscreen =
		showBottomControl && !hideLyricView && !!fullscreenButtonSlot;

	return (
		<LayoutGroup>
			<AutoLyricLayout
				onElementMounted={setLayoutEl}
				className={classNames(styles.autoLyricLayout, className)}
				onLayoutChange={setIsVertical}
				verticalImmerseCover={verticalImmerseCover}
				coverSlot={
					<Cover
						coverUrl={musicCover}
						coverIsVideo={musicCoverIsVideo}
						ref={coverElRef}
						musicPaused={
							!musicIsPlaying && !musicCoverIsVideo && verticalImmerseCover
						}
					/>
				}
				thumbSlot={<ControlThumb onClick={onClickControlThumb} />}
				smallControlsSlot={
					showSmallFullscreen ? (
						<div className={styles.smallControlsRow}>
							{smallMusicInfo}
							<div className={styles.smallFullscreenButton}>
								{fullscreenButtonSlot}
							</div>
						</div>
					) : (
						smallMusicInfo
					)
				}
				backgroundSlot={
					resolvedBackgroundRenderer === CSS_BACKGROUND_RENDERER_ID ? (
						<div
							style={{
								zIndex: -1,
								width: "100%",
								height: "100%",
								minWidth: "0",
								minHeight: "0",
								overflow: "hidden",
								background: cssBackgroundProperty,
							}}
						/>
					) : (
						<BackgroundRender
							album={musicCover}
							albumIsVideo={musicCoverIsVideo}
							lowFreqVolume={lowFreqVolume}
							renderScale={lyricBackgroundRenderScale}
							fps={lyricBackgroundFPS}
							renderer={resolvedBackgroundRenderer}
							staticMode={lyricBackgroundStaticMode || !isLyricPageOpened}
							configureRenderer={configureBackgroundRenderer}
							style={{
								zIndex: -1,
							}}
						/>
					)
				}
				bigControlsSlot={
					<>
						<PrebuiltMusicInfo
							className={classNames(
								styles.bigMusicInfo,
								hideLyricView && styles.hideLyric,
							)}
							favoriteButtonSlot={favoriteButtonSlot}
						/>
						<PrebuiltProgressBar />
						<PrebuiltMusicControls className={styles.bigControls} />
						{showBottomControl && (
							<div
								style={{
									display: "flex",
									justifyContent: "space-evenly",
								}}
							>
								{hideLyricView && fullscreenButtonSlot}
								<PrebuiltToggleIconButton
									type={PrebuiltToggleIconButtonType.Lyrics}
									checked={!hideLyricView}
									onClick={() => setHideLyricView(!hideLyricView)}
								/>
								<PrebuiltToggleIconButton
									type={PrebuiltToggleIconButtonType.AirPlay}
									onClick={onAirPlayClick}
								/>
								<PrebuiltToggleIconButton
									type={PrebuiltToggleIconButtonType.Playlist}
									onClick={onPlaylistClick}
								/>
							</div>
						)}
						<PrebuiltVolumeControl className={styles.bigVolumeControl} />
					</>
				}
				controlsSlot={
					<>
						<PrebuiltMusicInfo
							className={styles.horizontalControls}
							favoriteButtonSlot={favoriteButtonSlot}
						/>
						<PrebuiltProgressBar />
						<PrebuiltMusicControls
							className={classNames(styles.controls, styles.horizontalMediaControls)}
							showOtherButtons
						/>
						<PrebuiltVolumeControl />
					</>
				}
				horizontalBottomControls={
					showBottomControl && (
						<>
							{fullscreenButtonSlot}
							<PrebuiltToggleIconButton
								type={PrebuiltToggleIconButtonType.Playlist}
								onClick={onPlaylistClick}
							/>
							<PrebuiltToggleIconButton
								type={PrebuiltToggleIconButtonType.Lyrics}
								checked={!hideLyricView}
								onClick={() => setHideLyricView(!hideLyricView)}
							/>
							<div style={{ flex: "1" }} />
							<PrebuiltToggleIconButton
								type={PrebuiltToggleIconButtonType.AirPlay}
								onClick={onAirPlayClick}
							/>
						</>
					)
				}
				lyricSlot={
					<PrebuiltCoreLyricPlayer
						alignPosition={alignPosition}
						alignAnchor={alignAnchor}
						bottomLine={bottomLineSlot}
						optimizeOptions={optimizeOptions}
						lyricTimeOffsetMs={lyricTimeOffsetMs}
					/>
				}
				hideLyric={hideLyricView}
				{...rest}
			/>
		</LayoutGroup>
	);
};
