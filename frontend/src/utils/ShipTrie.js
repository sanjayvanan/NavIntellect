class TrieNode {
  constructor() {
    this.children = {}
    this.isEndOfWord = false
    this.ships = []
  }
}

export class ShipTrie {
  constructor() {
    this.root = new TrieNode()
  }

  insert(ship) {
    if (!ship || !ship.track_name || !ship.mmsi) return

    try {
      // Insert by ship name
      this._insertWord(ship.track_name.trim().toLowerCase(), ship)
      // Insert by MMSI
      this._insertWord(ship.mmsi.toString(), ship)
    } catch (error) {
      console.error('Error inserting ship into trie:', error)
    }
  }

  _insertWord(word, ship) {
    if (!word) return
    
    let current = this.root
    for (let char of word) {
      if (!current.children[char]) {
        current.children[char] = new TrieNode()
      }
      current = current.children[char]
      if (!current.ships.some(s => s?.uuid === ship?.uuid)) {
        current.ships.push(ship)
      }
    }
    current.isEndOfWord = true
  }

  search(prefix) {
    if (!prefix) return []
    
    try {
      prefix = prefix.toLowerCase()
      let current = this.root
      for (let char of prefix) {
        if (!current.children[char]) {
          return []
        }
        current = current.children[char]
      }
      return current.ships || []
    } catch (error) {
      console.error('Error searching trie:', error)
      return []
    }
  }

  clear() {
    this.root = new TrieNode()
  }
} 