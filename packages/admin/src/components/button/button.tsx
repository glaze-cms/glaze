import classNames from 'classnames';
import { Button as BaseButton } from '@base-ui/react';

/* Types */
import type { ButtonHTMLAttributes, ReactElement } from 'react';
import type { WithClassName } from '@/types';

/* Styles */
import './button.css';

interface ButtonProps extends WithClassName<
	ButtonHTMLAttributes<HTMLButtonElement>
> {
	fullWidth?: boolean;
	LeftIcon?: ReactElement;
	RightIcon?: ReactElement;
	isRounded?: boolean;
	size?: 'mini' | 'small' | 'large' | 'default';
	variant?: 'ghost' | 'outlined' | 'contained';
}

export function Button({
	children,
	color = 'primary',
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
				{
					[color]: Boolean(color),
					'full-width': fullWidth,
					[variant]: Boolean(variant),
					'rounded-full': isRounded,
					[size]: Boolean(size),
				},
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
