// The tour's current screen, picked by step. The login and model steps are the chat's own panels:
// the full screen draws them over the wordmark, the minimal screen shows them as it always does.
import { createElement as h, type ReactElement } from 'react';
import { type OnboardingState, progress } from './onboarding.ts';
import type { Onboarding } from './onboarding-flow.ts';
import {
  Backdrop,
  type FrameProps,
  GoalsView,
  KeysView,
  NameView,
  OfferView,
  PersonaliseView,
  WelcomeView,
} from './onboarding-ui.ts';

/** Stands in for the tour when the host has none. */
export const NO_TOUR: Pick<Onboarding, 'getState' | 'subscribe'> = {
  getState: () => undefined,
  subscribe: () => () => {},
};

export function TourView(p: {
  tour: Onboarding;
  state: OnboardingState;
  frame: FrameProps;
}): ReactElement | null {
  const { tour, state, frame } = p;
  const at = progress(state.step, tour.facts());
  switch (state.step) {
    case 'welcome':
      return h(WelcomeView, { key: 'welcome', ...frame, onDone: tour.begin, onSkip: tour.skip });
    case 'name':
      return h(NameView, {
        key: 'name',
        ...frame,
        progress: at,
        initial: state.name,
        onDone: tour.setName,
        onSkip: tour.skip,
      });
    case 'goals':
      return h(GoalsView, {
        key: 'goals',
        ...frame,
        progress: at,
        initial: state.goals,
        onDone: tour.setGoals,
        onSkip: tour.skip,
      });
    case 'personalise':
      return h(PersonaliseView, {
        key: 'personalise',
        ...frame,
        progress: at,
        initial: state.personalise,
        onDone: tour.setPersonalise,
        onSkip: tour.skip,
      });
    case 'provider':
    case 'model':
      return frame.inline ? null : h(Backdrop, frame);
    case 'offer':
      return h(OfferView, {
        key: 'offer',
        ...frame,
        progress: at,
        prompt: tour.firstTask().prompt,
        sampleFiles: tour.firstTask().files.length,
        onRun: tour.runTask,
        onPass: tour.passTask,
        onSkip: tour.skip,
      });
    case 'keys':
      return h(KeysView, { key: 'keys', ...frame, onDone: tour.next });
    default:
      return null;
  }
}
