import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  mode: 'light',
  clustering: true
}

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.mode = state.mode === 'light' ? 'dark' : 'light'
    },
    toggleClustering: (state) => {
      state.clustering = !state.clustering
    }
  }
})

export const { toggleTheme, toggleClustering } = themeSlice.actions
export default themeSlice.reducer 