import { Button as BaseButton } from '@base-ui/react';
import classNames from 'classnames';

import type { WithClassName } from '@/types';
import type { ButtonHTMLAttributes, ReactElement } from 'react';

import './button.css';

interface ButtonProps extends WithClassName<ButtonHTMLAttributes<HTMLButtonElement>> {
	fullWidth?: boolean;
	LeftIcon?: ReactElement;
	RightIcon?: ReactElement;
	isRounded?: boolean;
	size?: 'mini' | 'small' | 'large' | 'default';
	variant?: 'ghost' | 'outlined' | 'contained' | 'primary' | 'secondary';
}

/**
 * The app's button, wrapping Base UI's unstyled primitive.
 *
 * @param props.fullWidth - Stretch to the container width. Defaults to `true`.
 * @param props.LeftIcon - Icon rendered before the label.
 * @param props.RightIcon - Icon rendered after the label.
 * @param props.isRounded - Use a pill radius instead of the standard one.
 * @param props.size - Padding scale.
 * @param props.variant - Visual treatment.
 * @returns The button element.
 */
export function Button({
	children,
	className,
	fullWidth = true,
	LeftIcon,
	RightIcon,
	size = 'default',
	variant = 'ghost',
	isRounded = false,
	...props
}: ButtonProps) {
	return (
		<BaseButton
			className={classNames(
				'button',
				variant,
				size,
				{ 'full-width': fullWidth, 'rounded-full': isRounded },
				className,
			)}
			{...props}
		>
			{LeftIcon && <span className="left-icon">{LeftIcon}</span>}
			{children}
			{RightIcon && <span className="right-icon">{RightIcon}</span>}
		</BaseButton>
	);
}
