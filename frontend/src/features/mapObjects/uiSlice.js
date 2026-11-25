import { createSlice } from '@reduxjs/toolkit'

/**
 * Cross-component UI state for map objects:
 *  - selection: the object whose details are shown ({ type: 'zone' | 'pin', id } or null)
 *  - command:   a request from outside the panel (map context menu, …) that the panel carries
 *               out once open, e.g. { kind: 'dropPin', latlng } or { kind: 'measureFrom', latlng }.
 *               `seq` makes repeated identical commands distinct.
 */
const initialState = { selection: null, command: null }

const SIGNED_OUT = ['auth/logout/fulfilled', 'auth/sessionExpired']

const uiSlice = createSlice({
  name: 'mapObjectsUi',
  initialState,
  reducers: {
    selectObject: (state, action) => {
      state.selection = action.payload // { type, id } | null
    },
    issueCommand: (state, action) => {
      state.command = { ...action.payload, seq: (state.command?.seq ?? 0) + 1 }
    },
    commandHandled: (state, action) => {
      if (state.command?.seq === action.payload) state.command = null
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      // A deleted object can't stay selected.
      (a) => a.type === 'zones/delete/fulfilled' || a.type === 'pins/delete/fulfilled',
      (state, action) => {
        if (state.selection?.id === action.payload) state.selection = null
      },
    )
    builder.addMatcher((a) => SIGNED_OUT.includes(a.type), () => initialState)
  },
})

export const { selectObject, issueCommand, commandHandled } = uiSlice.actions
export default uiSlice.reducer

export const selectSelection = (state) => state.mapObjectsUi.selection
export const isSelected = (selection, type, id) => selection?.type === type && selection.id === id
