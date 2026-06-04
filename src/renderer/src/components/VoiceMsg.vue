<!--
 * @FileDescription: 语音消息组件
 * @Description: 渲染 QQ 语音消息，支持播放/暂停、进度显示和时长展示。
 *   语音消息通过 recordUtil 调用 OneBot get_record API 加载。
 *   如果协议端不支持格式转换，显示"不支持的消息"。
-->

<template>
    <div class="voice-msg"
        :class="{ me: isMe, loading: isLoading, playing: isPlaying }"
        :style="bubbleStyle"
        @click.stop="togglePlay">
        <!-- 播放/加载图标 -->
        <div class="voice-icon">
            <font-awesome-icon v-if="isLoading" :icon="['fas', 'spinner']" spin />
            <font-awesome-icon v-else-if="isError" :icon="['fas', 'exclamation-circle']" />
            <font-awesome-icon v-else-if="isPlaying" :icon="['fas', 'pause']" />
            <font-awesome-icon v-else :icon="['fas', 'play']" />
        </div>

        <!-- 进度条区域 -->
        <div class="voice-progress">
            <template v-if="isUnsupported">
                <span class="voice-unsupported">{{ $t('不支持的消息') }}</span>
            </template>
            <template v-else>
                <div class="voice-bar-bg">
                    <div class="voice-bar-fill" :style="{ width: progressPercent + '%' }" />
                </div>
                <span class="voice-duration">
                    {{ isError ? $t('加载失败') : formatTime }}
                </span>
            </template>
        </div>

        <!-- 音频元素，仅在有可用 src 时渲染 -->
        <audio v-if="audioSrc"
            ref="audioRef"
            :src="audioSrc"
            preload="auto"
            @loadedmetadata="onLoaded"
            @error="onError"
            @timeupdate="onTimeUpdate"
            @ended="onEnded"
            @play="isPlaying = true"
            @pause="isPlaying = false" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { loadRecord, revokeRecord, formatRecordDuration, type RecordMsgData } from '@renderer/function/utils/recordUtil'
import { Logger } from '@renderer/function/base'

const logger = new Logger()

// ============================================================================
// Props
// ============================================================================

const props = defineProps<{
    /** 语音消息数据 */
    item: RecordMsgData
    /** 消息 ID（用于缓存） */
    messageId?: string
    /** 是否为本人发送的消息 */
    isMe?: boolean
}>()

// ============================================================================
// 响应式状态
// ============================================================================

const audioRef = ref<HTMLAudioElement | null>(null)
const audioSrc = ref<string>('')
const isLoading = ref(false)
const isError = ref(false)
const isUnsupported = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(props.item.duration || 0)
const loaded = ref(false)

// ============================================================================
// 计算属性
// ============================================================================

const progressPercent = computed(() => {
    if (duration.value <= 0) return 0
    return Math.min(100, (currentTime.value / duration.value) * 100)
})

const formatTime = computed(() => {
    if (isLoading.value) return '--:--'
    if (isError.value) return '⚠'
    if (isUnsupported.value) return ''
    if (!loaded.value && duration.value <= 0) return '--:--'
    if (isPlaying.value || currentTime.value > 0) {
        return formatRecordDuration(currentTime.value)
    }
    return formatRecordDuration(duration.value)
})

/**
 * 根据语音时长计算气泡宽度
 * 模仿 QQ 语音消息样式：时长越长，气泡越宽
 * 范围：120px (最短) ~ 260px (最长，上限 60 秒)
 */
const bubbleStyle = computed(() => {
    const dur = duration.value || 1
    const minWidth = 120
    const maxWidth = 260
    const width = Math.min(maxWidth, Math.max(minWidth, minWidth + (dur / 60) * (maxWidth - minWidth)))
    return {
        width: `${Math.round(width)}px`,
    }
})

// ============================================================================
// 方法
// ============================================================================

/**
 * 加载语音资源
 */
async function loadVoice() {
    if (loaded.value || isLoading.value) return

    isLoading.value = true
    isError.value = false
    isUnsupported.value = false

    try {
        const result = await loadRecord(props.item, props.messageId)
        audioSrc.value = result.src
        duration.value = result.duration || props.item.duration || 0
        loaded.value = true

        logger.debug(`语音加载完成: 时长=${duration.value}s`)
    } catch (e) {
        logger.error(e as Error, '语音加载失败')
        // 根据错误信息判断是否因为 OneBot 不支持
        const msg = (e as Error).message || ''
        if (msg.includes('不支持') || msg.includes('缺少 file')) {
            isUnsupported.value = true
        } else {
            isError.value = true
        }
    } finally {
        isLoading.value = false
    }
}

/**
 * 切换播放/暂停
 */
function togglePlay() {
    if (isUnsupported.value) return

    if (isError.value) {
        // 点击重试
        isError.value = false
        loaded.value = false
        audioSrc.value = ''
        loadVoice()
        return
    }

    if (!loaded.value) {
        loadVoice()
        return
    }

    const audio = audioRef.value
    if (!audio) return

    if (audio.paused) {
        audio.play().catch((e) => {
            logger.error(e, '语音播放失败')
            isError.value = true
        })
    } else {
        audio.pause()
    }
}

/**
 * 音频加载完成
 */
function onLoaded() {
    const audio = audioRef.value
    if (audio && audio.duration && !duration.value) {
        duration.value = audio.duration
    }
    logger.debug(`音频元数据加载完成: ${duration.value}s`)
}

/**
 * 音频加载失败
 */
function onError() {
    logger.error(null, '音频播放错误')
    isError.value = true
    isPlaying.value = false
}

/**
 * 播放时间更新
 */
function onTimeUpdate() {
    const audio = audioRef.value
    if (audio) {
        currentTime.value = audio.currentTime
    }
}

/**
 * 播放结束
 */
function onEnded() {
    isPlaying.value = false
    currentTime.value = 0
}

// ============================================================================
// 生命周期
// ============================================================================

onMounted(() => {
    loadVoice()
})

onBeforeUnmount(() => {
    // 停止播放
    const audio = audioRef.value
    if (audio) {
        audio.pause()
        audio.src = ''
    }
    // 释放缓存的 blob URL
    revokeRecord(props.messageId)
})
</script>

<style scoped>
.voice-msg {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    border-radius: 10px;
    background: var(--color-card-2);
    transition: all 0.2s ease;
}

.voice-msg:hover {
    background: var(--color-card-1);
    transform: scale(1.01);
}

.voice-msg.me {
    background: var(--color-card-1);
}

.voice-msg.me:hover {
    background: var(--color-card);
}

.voice-msg.loading {
    opacity: 0.7;
    pointer-events: none;
}

.voice-msg.playing .voice-icon {
    color: var(--color-main);
}

/* 播放图标 */
.voice-icon {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-card);
    color: var(--color-font-2);
    font-size: 14px;
    transition: all 0.2s ease;
}

.voice-msg.me .voice-icon {
    background: var(--color-card-2);
    color: var(--color-main);
}

.voice-msg.playing .voice-icon {
    background: var(--color-main);
    color: var(--color-font-r);
}

/* 进度条区域 */
.voice-progress {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.voice-bar-bg {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: var(--color-card-1);
    overflow: hidden;
}

.voice-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--color-main);
    transition: width 0.1s linear;
}

.voice-duration {
    font-size: 0.75rem;
    color: var(--color-font-2);
    white-space: nowrap;
}

.voice-unsupported {
    font-size: 0.75rem;
    color: var(--color-font-2);
    opacity: 0.6;
    font-style: italic;
}

.voice-msg.me .voice-duration {
    color: var(--color-font-1);
}
</style>
