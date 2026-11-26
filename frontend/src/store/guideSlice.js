import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { copilotApi } from '../services/copilot'
import { guideTargets } from '../guide/targets'
import { isPhoneLayout } from '../hooks/usePhoneLayout'

/**
 * Shadow-cursor guide: Gemini turns "how do I…?" into steps that point at controls on screen
 * (see guide/targets.js); ShadowGuide walks through them.
 * status: idle | loading | running | done | error
 */
export const startGuide = createAsyncThunk('guide/start', async (question, { signal }) => {
  const layout = isPhoneLayout() ? 'phone' : 'desktop'
  // Start from what is open now (the AI panel itself closes when the guide starts).
  const open = document.querySelector('[data-guide-panel]')?.getAttribute('data-guide-panel') ?? null
  return copilotApi.guide({ question, layout, panel: open === 'ai' ? null : open, targets: guideTargets(layout) }, signal)
})

const initialState = { status: 'idle', title: '', steps: [], index: 0, note: null, error: null }

const guideSlice = createSlice({
  name: 'guide',
  initialState,
  reducers: {
    nextStep: (state) => {
      if (state.status !== 'running') return
      if (state.index < state.steps.length - 1) state.index += 1
      else state.status = 'done'
    },
    previousStep: (state) => {
      if (state.status === 'running' && state.index > 0) state.index -= 1
    },
    stopGuide: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(startGuide.pending, () => ({ ...initialState, status: 'loading' }))
      .addCase(startGuide.fulfilled, (state, action) => {
        const { title, steps, note } = action.payload
        if (!steps?.length) return { ...initialState, status: 'idle', note }
        return { ...initialState, status: 'running', title, steps, note }
      })
      .addCase(startGuide.rejected, (state, action) => {
        if (action.meta.aborted) return initialState
        return { ...initialState, status: 'error', error: action.error.message || 'The guide could not start.' }
      })
      .addMatcher((a) => a.type === 'auth/logout/fulfilled' || a.type === 'auth/sessionExpired', () => initialState)
  },
})

export const { nextStep, previousStep, stopGuide } = guideSlice.actions
export default guideSlice.reducer
