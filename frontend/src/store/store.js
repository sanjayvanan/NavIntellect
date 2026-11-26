import { configureStore } from '@reduxjs/toolkit'
import themeReducer from './themeSlice'
import shipReducer from './shipSlice'
import authReducer from './authSlice'
import alertsReducer from './alertsSlice'
import copilotReducer, { conversationRestored, loadChat, saveChat } from './copilotSlice'
import guideReducer from './guideSlice'
import { mapObjectsReducers } from '../features/mapObjects'
import { settingsSync } from './settingsSync'
import { errorMiddleware } from '../middleware/errorMiddleware'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    theme: themeReducer,
    ships: shipReducer,
    alerts: alertsReducer,
    copilot: copilotReducer,
    guide: guideReducer,
    ...mapObjectsReducers,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['ships/setSelectedShip'],
        // Ignore these field paths in all actions
        ignoredActionPaths: ['payload.timestamp'],
      }
    }).prepend(settingsSync.middleware).concat(errorMiddleware),
  devTools: process.env.NODE_ENV !== 'production',
  devTools: {
    name: 'Ship Tracking App',
    trace: true,
    traceLimit: 25
  }
})

// Keep each user's copilot chat in this browser, so it is still there after a reload or sign-in.
let chatUser = null
let savedChats = null
let savedActive = null
store.subscribe(() => {
  const state = store.getState()
  const userId = state.auth.user?.id ?? null
  if (userId !== chatUser) {
    chatUser = userId
    if (userId) store.dispatch(conversationRestored(loadChat(userId)))
    savedChats = store.getState().copilot.chats
    savedActive = store.getState().copilot.activeChatId
    return
  }
  const { chats, activeChatId } = state.copilot
  if (userId && (chats !== savedChats || activeChatId !== savedActive)) {
    savedChats = chats
    savedActive = activeChatId
    saveChat(userId, { chats, activeChatId })
  }
})

// Add hot reloading in development
if (import.meta.hot) {
  import.meta.hot.accept(['./themeSlice', './shipSlice'], ([
    newThemeModule,
    newShipModule
  ]) => {
    store.replaceReducer({
      auth: authReducer,
      theme: newThemeModule?.default,
      ships: newShipModule?.default,
      alerts: alertsReducer,
      copilot: copilotReducer,
      ...mapObjectsReducers,
    })
  })
} 