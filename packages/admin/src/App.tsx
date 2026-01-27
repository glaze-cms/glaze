import { useEffect, useState } from 'react';
import { Button, Card } from '@heroui/react';

import reactLogo from './assets/react.svg';

function App() {
	const [message, setMessage] = useState('');

	useEffect(() => {
		fetch('/api/health')
			.then((res) => res.json())
			.then((data) => {
				setMessage(data.message as string);
			})
			.catch(() => {
				setMessage('Error connecting to server');
			});
	}, []);

	return (
		<main>
			<div>
				<a href="https://react.dev" target="_blank">
					<img
						src={reactLogo as string}
						className="logo react"
						alt="React logo"
					/>
				</a>
			</div>
			<Button>hola</Button>
			<Card variant="default">PRIMARY</Card>
			<div className="bg-surface-secondary">SECONDARY</div>

			<h1>{message}</h1>

			<div className="bg-surface-tertiary">TERTIARY</div>
		</main>
	);
}

export default App;
