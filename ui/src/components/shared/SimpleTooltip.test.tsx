import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import SimpleTooltip, { SimpleTooltipScope } from './SimpleTooltip';

afterEach(cleanup);

it('moves one shared tooltip between row triggers and retires an unmounted trigger', async () => {
  const user = userEvent.setup();
  function Rows({ first = true }: { first?: boolean }) {
    return <SimpleTooltipScope>
      {first && <SimpleTooltip content="First row details" delay={0}><button>First row</button></SimpleTooltip>}
      <SimpleTooltip content="Second row details" delay={0}><button>Second row</button></SimpleTooltip>
    </SimpleTooltipScope>;
  }
  const app = render(<Rows />);
  await user.hover(screen.getByRole('button', { name: 'First row' }));
  expect(await screen.findByRole('tooltip')).toHaveTextContent('First row details');
  await user.unhover(screen.getByRole('button', { name: 'First row' }));
  await user.hover(screen.getByRole('button', { name: 'Second row' }));
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Second row details'));
  expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  await user.unhover(screen.getByRole('button', { name: 'Second row' }));
  await user.tab();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('First row details');
  app.rerender(<Rows first={false} />);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  expect(screen.getByRole('button', { name: 'Second row' })).toBeVisible();
});
