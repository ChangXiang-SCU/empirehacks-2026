export const DIKW_COLORS = {
  D: '#3949ab',  // Data - blue
  I: '#00897b',  // Information - teal
  K: '#f57c00',  // Knowledge - orange
  W: '#e53935'   // Wisdom - red
}

export const DIKW_LABELS = {
  D: 'Data',
  I: 'Information',
  K: 'Knowledge',
  W: 'Wisdom'
}

export const DIKW_DESCRIPTIONS = {
  D: 'Raw facts and observations',
  I: 'Contextualized data',
  K: 'Reusable patterns and skills',
  W: 'Meta-level judgment and guidance'
}

export const getColorByType = (type) => {
  return DIKW_COLORS[type] || '#999999'
}

export const getLabelByType = (type) => {
  return DIKW_LABELS[type] || 'Unknown'
}
