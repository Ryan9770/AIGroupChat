export function applyEvent(state, event) {
  switch (event.type) {
    case 'charge':
      return { ...state, balance: state.balance + event.amount };
    case 'payout':
      return { ...state, balance: state.balance - event.amount };
    default:
      return state;
  }
}

export function reduce(events) {
  return events.reduce(applyEvent, { balance: 0 });
}
