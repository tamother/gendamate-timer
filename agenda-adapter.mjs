// Future integration boundary. Keep AgendaMate parsing and persistence outside the timer.
export function taskConfigFromAgendaItem(item) {
  return {
    title: item.title,
    activity: item.activity ?? 'custom',
    agendaSource: { provider: 'agendamate', meetingId: item.meetingId, itemId: item.id },
    thresholds: item.thresholds,
  };
}

export async function loadAgendaTasks(_meetingId) {
  return []; // Replace with AgendaMate read adapter when its API is available.
}

export async function saveTimingRecord(_task) {
  // Replace with AgendaMate write adapter when its API is available.
}
