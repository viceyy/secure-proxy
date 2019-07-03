import {View} from '../view.js'
import {escapedTemplate} from '../template.js'

// Login view.
class ViewLogin extends View {
  show() {
    return escapedTemplate`<p>
      ${this.getTranslation("notLoggedIn")}
    </p>
    <button id="authButton">
      ${this.getTranslation("activateButton")}
    </button>`;
  }

  handleEvent(e) {
    if (e.target.id == "authButton") {
      View.sendMessage("authenticate");
    }
  }
}

const view = new ViewLogin();
const name = "login";

View.registerView(view, name);
export default name;
