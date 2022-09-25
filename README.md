# JSX Reconstructor

This project was made with the intention of turning compiled React code back into JSX.

For example,

```js
const x = React.createElement("div", null, "Hello, World!");
```

Should become:

```jsx
const x = <div>Hello, World!</div>;
```

## Caution!

This code is extremely shit and WIP. Please do give it a try and create an issue if you find any problems! Please provide some example code that I can work with to diagnose the issue. Thanks :)

## Usage

1. `npm install`
2. Create a folder called `input` and place your `.js` files in there.
3. Run `npm run start`

Copyright &copy; 2022, https://github.com/MeguminSama
