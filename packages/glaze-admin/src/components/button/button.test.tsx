import { expect, mock, test } from 'bun:test';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from './button.tsx';

test('renders its label and the classes for the chosen variant and size', () => {
	render(
		<Button variant="primary" size="small">
			Save
		</Button>,
	);

	const button = screen.getByRole('button', { name: 'Save' });
	expect(button.classList.contains('primary')).toBe(true);
	expect(button.classList.contains('small')).toBe(true);
	expect(button.classList.contains('full-width')).toBe(true);
});

test('a disabled button does not fire its click handler', async () => {
	const onClick = mock(() => undefined);
	render(
		<Button disabled onClick={onClick}>
			Save
		</Button>,
	);

	await userEvent.click(screen.getByRole('button', { name: 'Save' }));

	expect(onClick).toHaveBeenCalledTimes(0);
});

test('icons are rendered around the label', () => {
	render(
		<Button LeftIcon={<span data-testid="left" />} RightIcon={<span data-testid="right" />}>
			Save
		</Button>,
	);

	expect(screen.getByTestId('left')).toBeDefined();
	expect(screen.getByTestId('right')).toBeDefined();
});
